import { WritebackConflictError } from './github-writeback.client';
import { putFileWithMerge } from './writeback-merge';

/**
 * Fake do GitHub: guarda conteúdo + sha e rejeita PUT com sha desatualizado,
 * como a Contents API faz. É o mínimo para exercitar o 409 de verdade —
 * mockar `putFile` para "lançar uma vez" provaria que o retry acontece, não
 * que ele reaplica o merge, que é o ponto.
 */
function fakeGithub(initial: { content: string; sha: string } | null) {
  let file = initial;
  const puts: string[] = [];
  return {
    puts,
    /** Simula alguém editando o arquivo à mão no GitHub. */
    editOutside(content: string, sha: string) {
      file = { content, sha };
    },
    client: {
      getFile: async () => (file ? { ...file } : null),
      getFileSha: async () => file?.sha ?? null,
      putFile: async (p: { content: string; baseSha: string | null }) => {
        if ((file?.sha ?? null) !== p.baseSha) throw new WritebackConflictError();
        puts.push(p.content);
        file = { content: p.content, sha: `sha-${puts.length}` };
        return file.sha;
      },
    },
  };
}

const base = {
  token: 't',
  owner: 'RodReis',
  repo: 'rrb-proplan',
  path: '.proplan/config.yml',
  branch: 'main',
  message: 'proplan: mapeia',
};

describe('putFileWithMerge', () => {
  it('escreve o merge sobre o conteúdo atual quando não há conflito', async () => {
    const gh = fakeGithub({ content: 'a: 1', sha: 'sha-0' });

    const newSha = await putFileWithMerge({
      ...base,
      writeback: gh.client as never,
      mutate: (cur) => `${cur}\nb: 2`,
    });

    expect(gh.puts).toEqual(['a: 1\nb: 2']);
    expect(newSha).toBe('sha-1');
  });

  /**
   * O bug documentado (code review da Fatia 10). Antes: o conteúdo era
   * computado uma vez, antes do loop; no retry só o `baseSha` era re-lido e o
   * merge velho ia junto — apagando a edição de quem mexeu no GitHub.
   */
  it('reaplica o merge sobre a edição concorrente em vez de sobrescrevê-la', async () => {
    const gh = fakeGithub({ content: 'a: 1', sha: 'sha-0' });

    // A corrida real: alguém commita DEPOIS do nosso GET e ANTES do nosso PUT.
    // O 1º PUT bate 409 (o sha que lemos morreu); o retry tem de reler o vivo.
    let raced = false;
    const client = {
      ...gh.client,
      getFile: async () => {
        const seen = await gh.client.getFile();
        if (!raced) {
          raced = true;
          gh.editOutside('a: 1\nfeito-a-mao: sim', 'sha-outro');
        }
        return seen;
      },
    };

    const newSha = await putFileWithMerge({
      ...base,
      writeback: client as never,
      mutate: (cur) => `${cur}\nb: 2`,
    });

    // Um único PUT chegou a passar — o primeiro morreu no 409.
    expect(gh.puts).toHaveLength(1);
    // E ele preserva a edição concorrente E aplica a nossa mudança.
    expect(gh.puts[0]).toBe('a: 1\nfeito-a-mao: sim\nb: 2');
    expect(newSha).toBe('sha-1');
  });

  it('cria o arquivo quando ainda não existe (mutate recebe null)', async () => {
    const gh = fakeGithub(null);

    await putFileWithMerge({
      ...base,
      writeback: gh.client as never,
      mutate: (cur) => (cur === null ? 'novo: 1' : `${cur}\nnovo: 1`),
    });

    expect(gh.puts).toEqual(['novo: 1']);
  });

  // Um retry, não N: o contrato do ARCHITECTURE.md é explícito. Conflito que
  // persiste vira erro para a aba mostrar "resolva no repo".
  // Um retry, não N: o contrato do ARCHITECTURE.md é explícito. Conflito que
  // persiste vira erro para a aba mostrar "resolva no repo".
  it('desiste depois de um retry e propaga o conflito', async () => {
    const gh = fakeGithub({ content: 'a: 1', sha: 'sha-0' });
    // Conflito perpétuo: alguém commita depois de cada leitura nossa.
    let n = 0;
    const client = {
      ...gh.client,
      getFile: async () => {
        const seen = await gh.client.getFile();
        gh.editOutside('outro', `sha-concorrente-${n++}`);
        return seen;
      },
    };

    await expect(
      putFileWithMerge({
        ...base,
        writeback: client as never,
        mutate: (cur) => `${cur}\nb: 2`,
      }),
    ).rejects.toBeInstanceOf(WritebackConflictError);

    // Nenhum PUT passou — e, crucialmente, nada foi sobrescrito.
    expect(gh.puts).toHaveLength(0);
  });

  it('propaga erro que não é conflito sem tentar de novo', async () => {
    const client = {
      getFile: async () => ({ content: 'a: 1', sha: 'sha-0' }),
      putFile: async () => {
        throw new Error('GitHub Contents PUT 500');
      },
    };

    await expect(
      putFileWithMerge({ ...base, writeback: client as never, mutate: (c) => `${c}!` }),
    ).rejects.toThrow('500');
  });
});
