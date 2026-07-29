import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A fronteira do módulo `dashboard` (SPEC-035 §2.1, §5), provada por varredura
 * estática — o instrumento da casa (`estimates-boundaries`, `tenant-scope`,
 * `llm-public-surface`).
 *
 * Por que varredura e não confiança no `@Module`: o `exports` do Nest resolve
 * **injeção**, não resolve o import de TypeScript (ADR-027). E `PrismaService` é
 * global — nada impediria o agregador de fazer `prisma.contract.count` direto.
 * Funcionaria hoje, e a fronteira teria desmanchado em silêncio, que é
 * exatamente o modo de falha que o §5 manda barrar:
 *
 * > *"O agregador não importa entidade interna de outro módulo nem chama
 * > `prisma` de tabela de outro módulo direto — `dashboard.arch.spec.ts` quebra
 * > o build se acontecer."*
 *
 * O risco aqui é maior que no `estimates`: este módulo lê **cinco** módulos, e
 * cada bloco da tela é uma tentação de "só um `count` rapidinho".
 */

const RAIZ = join(__dirname);

/** Todos os `.ts` do módulo, menos os próprios testes. */
function arquivosDoModulo(dir: string = RAIZ): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      out.push(...arquivosDoModulo(caminho));
      continue;
    }
    if (!entrada.endsWith('.ts')) continue;
    if (entrada.endsWith('.spec.ts')) continue;
    out.push(caminho);
  }
  return out;
}

interface Ocorrencia {
  arquivo: string;
  linha: number;
  texto: string;
}

/**
 * Tira o que é comentário de uma linha — a regra é sobre o que **executa**, e os
 * arquivos deste módulo explicam a fronteira em prosa, incluindo os nomes que a
 * varredura procura.
 *
 * O `\r?$` não é zelo: com checkout em CRLF (o padrão no Windows), `.*$` para
 * **antes** do `\r` e a linha de comentário sobrevive ao filtro inteira. O
 * sintoma é o teste reprovar o próprio comentário que descreve a regra — e só na
 * máquina de quem tem `autocrlf` ligado, que é o pior tipo de teste instável.
 */
function semComentario(linha: string): string {
  return linha.replace(/\/\/.*\r?$/, '').replace(/^\s*\*.*\r?$/, '');
}

function varrer(padrao: RegExp): Ocorrencia[] {
  const achados: Ocorrencia[] = [];
  for (const arquivo of arquivosDoModulo()) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((texto, i) => {
      if (padrao.test(semComentario(texto))) {
        achados.push({ arquivo: arquivo.replace(RAIZ, ''), linha: i + 1, texto: texto.trim() });
      }
    });
  }
  return achados;
}

describe('dashboard: a fronteira com os cinco módulos (ADR-001, §5)', () => {
  it('a varredura enxerga os arquivos do módulo — senão passaria vazia', () => {
    // Sem esta âncora, um erro no caminho transformaria os testes abaixo em
    // "nenhum arquivo, logo nenhuma violação": verde e sem valor nenhum.
    expect(arquivosDoModulo().length).toBeGreaterThanOrEqual(5);
  });

  it('não consulta NENHUMA tabela de outro módulo pelo prisma', () => {
    // A lista nomeia as tabelas que os blocos da tela leem (§6). Cada uma tem
    // dono, e o dono expõe o resumo — `ClientsSummaryService`,
    // `ArtifactsSummaryService`, `EstimatesSummaryService`,
    // `ContractsSummaryService`, `ActivitySummaryService`.
    const proibidas = [
      'client',
      'clientProject',
      'clientStatusTransition',
      'artifact',
      'artifactVersion',
      'artifactRun',
      'estimate',
      'briefingVersion',
      'contract',
      'contractLink',
      'auditEvent',
      'syncRun',
    ];
    const acessos = varrer(new RegExp(`prisma\\.(${proibidas.join('|')})\\.`));
    expect(acessos).toEqual([]);
  });

  it('a ÚNICA tabela que o módulo toca é a própria configuração', () => {
    // `tenant_settings` guarda o limite de "parado" (§6), e é a exceção
    // deliberada: o dashboard não guarda os NÚMEROS da tela, mas guarda a
    // preferência que os calcula. Se um dia aparecer outra tabela aqui, este
    // teste falha e alguém tem de justificá-la — que é o ponto.
    const tabelas = new Set(
      varrer(/prisma\.[a-zA-Z]+\./)
        .map((o) => /prisma\.([a-zA-Z]+)\./.exec(o.texto)?.[1])
        .filter((t): t is string => Boolean(t)),
    );
    expect([...tabelas]).toEqual(['tenantSettings']);
  });

  it('não importa entidade interna (`domain/` ou `infrastructure/`) de outro módulo', () => {
    // O que atravessa a fronteira é `application/*-summary.service`, e só. Um
    // import de `domain/` significaria o dashboard reimplementando regra que
    // pertence a outro módulo — a projeção estado→coluna, por exemplo, que já
    // acontece dentro do `clients`.
    //
    // **Uma exceção nominal**, no padrão de `provider-profile` na SPEC-034 e da
    // allowlist da SPEC-033: `board/domain/rate-limit`. A regra existe para
    // impedir reimplementar regra alheia, e importar o **tipo do erro que o
    // service público lança** é o oposto disso — é usar a interface dele. Sem
    // ele, distinguir rate limit de falha comum viraria casar a mensagem por
    // string, que quebra em silêncio na primeira vez que o texto mudar; e o
    // §2.11 exige a distinção, porque zero silencioso é indistinguível de board
    // vazio.
    //
    // Lista de NOMES, não padrão aberto: qualquer outro `domain/` derruba isto.
    const EXCECOES = ['board/domain/rate-limit'];
    const proibidos = varrer(/from '\.\.\/\.\.\/[a-z]+\/(domain|infrastructure)\//).filter(
      (o) => !EXCECOES.some((e) => o.texto.includes(e)),
    );
    expect(proibidos).toEqual([]);
  });

  it('a exceção do `rate-limit` é o que está escrito — e nada além', () => {
    // Sem este teste, a lista acima poderia crescer sem ninguém notar: o outro
    // teste ficaria verde justamente por causa do item novo.
    const daBoard = varrer(/from '\.\.\/\.\.\/board\/domain\//).map((o) => o.texto);
    for (const linha of daBoard) {
      expect(linha).toContain('board/domain/rate-limit');
    }
  });

  it('o agregador NÃO recebe PrismaService — sem cliente injetado, sem acidente', () => {
    // É o mecanismo, não o estilo: a fronteira deixa de depender de alguém
    // lembrar dela. O `DashboardSettingsService` recebe (é o dono da própria
    // configuração); o `DashboardService`, que compõe os cinco módulos, não.
    // Comentário não é código, mesma regra da `varrer`: o cabeçalho do
    // agregador EXPLICA que não recebe `PrismaService`, e a explicação não pode
    // reprovar o próprio arquivo que ela descreve.
    const codigo = readFileSync(join(RAIZ, 'application', 'dashboard.service.ts'), 'utf8')
      .split('\n')
      .map(semComentario)
      .join('\n');
    expect(codigo).not.toMatch(/PrismaService/);
  });
});

describe('dashboard: não escreve nada dos outros módulos (§2, §3)', () => {
  it('nenhuma escrita em tabela nenhuma além da própria configuração', () => {
    // "O dashboard lê; não escreve nada" (§3). A exceção é `tenant_settings`,
    // e ela é a configuração DELE — não dado de outro módulo.
    const escritas = varrer(
      /prisma\.(?!tenantSettings)[a-zA-Z]+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/,
    );
    expect(escritas).toEqual([]);
  });

  it('não há tabela de notificação nem cache do board (§3, §7.4)', () => {
    // Uma tabela de notificação seria uma segunda verdade sobre o mesmo estado,
    // e a primeira vez que alguém aprovasse um artefato por um caminho que
    // esqueceu de atualizá-la, o contador mentiria. Derivar sempre é mais lento
    // e nunca mente.
    expect(varrer(/prisma\.(notification|dashboardCache|boardSnapshot)/)).toEqual([]);
  });
});

describe('dashboard: o contador não faz polling (§2.10, §5)', () => {
  it('nenhum `setInterval` no módulo — auditável por ausência', () => {
    // O critério de aceite cobra a ausência por nome. O lado do servidor não
    // tem por que ter um; o teste equivalente do cliente vive no PR-4.
    expect(varrer(/setInterval/)).toEqual([]);
  });
});
