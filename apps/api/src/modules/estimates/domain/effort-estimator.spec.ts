import {
  EFFORT_SYSTEM,
  InvalidEffortError,
  MAX_HORAS_POR_TAREFA,
  buildEffortUser,
  parseEffort,
  requisitosSemTarefa,
  titulosDeRequisitos,
} from './effort-estimator';

const REQUISITOS = ['Login com Google', 'Painel do cliente'];

/** Uma tarefa válida; `over` sobrescreve campos para o caso sob teste. */
function tarefa(over: Record<string, unknown> = {}) {
  return {
    requisito: 'Login com Google',
    tarefa: 'Configurar OAuth',
    horasMin: 4,
    horasProvavel: 6,
    horasMax: 10,
    mvp: 'MVP1',
    ...over,
  };
}

function resposta(...tarefas: unknown[]): string {
  return JSON.stringify({ tarefas });
}

describe('EffortEstimator: o schema que barra resposta ruim', () => {
  it('aceita uma decomposição bem formada', () => {
    const out = parseEffort(resposta(tarefa()), REQUISITOS);
    expect(out.tarefas).toHaveLength(1);
    expect(out.tarefas[0]).toEqual({
      requisito: 'Login com Google',
      tarefa: 'Configurar OAuth',
      horasMin: 4,
      horasProvavel: 6,
      horasMax: 10,
      mvp: 'MVP1',
    });
  });

  it('extrai o JSON mesmo com texto em volta', () => {
    const texto = `Claro! Segue:\n\n${resposta(tarefa())}\n\nEspero ter ajudado.`;
    expect(parseEffort(texto, REQUISITOS).tarefas).toHaveLength(1);
  });

  it.each([
    ['sem JSON nenhum', 'não consegui responder'],
    ['JSON malformado', '{"tarefas": ['],
    ['raiz que não é objeto', '[1, 2, 3]'],
    ['sem o campo tarefas', '{"outra": []}'],
    ['lista vazia', '{"tarefas": []}'],
  ])('recusa %s', (_caso, texto) => {
    expect(() => parseEffort(texto, REQUISITOS)).toThrow(InvalidEffortError);
  });

  // O critério de aceite do §5, e a barreira mais importante do arquivo: uma
  // faixa invertida NÃO quebra nada na hora — os três cenários continuam
  // somando, e o "otimista" só sai maior que o "pessimista". Ninguém lê isso
  // como defeito.
  it.each([
    ['min > provável', { horasMin: 9, horasProvavel: 6, horasMax: 10 }],
    ['provável > máx', { horasMin: 4, horasProvavel: 12, horasMax: 10 }],
    ['tudo invertido', { horasMin: 10, horasProvavel: 6, horasMax: 4 }],
  ])('recusa faixa fora da ordem: %s', (_caso, horas) => {
    expect(() => parseEffort(resposta(tarefa(horas)), REQUISITOS)).toThrow(
      /min <= provável <= máx/,
    );
  });

  it('aceita os três valores iguais (faixa de largura zero)', () => {
    // `min <= provável <= máx` é não-estrito de propósito: tarefa mecânica pode
    // ter estimativa sem incerteza, e exigir faixa larga obrigaria o modelo a
    // inventar variação que ele não vê.
    const out = parseEffort(
      resposta(tarefa({ horasMin: 2, horasProvavel: 2, horasMax: 2 })),
      REQUISITOS,
    );
    expect(out.tarefas[0].horasProvavel).toBe(2);
  });

  it.each([
    ['texto no lugar de número', { horasMin: 'quatro' }],
    ['null', { horasProvavel: null }],
    ['ausente', { horasMax: undefined }],
  ])('recusa horas que não são número: %s', (_caso, over) => {
    expect(() => parseEffort(resposta(tarefa(over)), REQUISITOS)).toThrow(
      InvalidEffortError,
    );
  });

  it('recusa horas não-finitas (o `1e999` que vira Infinity)', () => {
    // JSON.parse('1e999') devolve Infinity sem erro. Ele sobreviveria a toda
    // soma e contaminaria o total inteiro, sem nunca lançar.
    const texto = '{"tarefas":[{"requisito":"Login com Google","tarefa":"x","horasMin":1,"horasProvavel":2,"horasMax":1e999,"mvp":"MVP1"}]}';
    expect(() => parseEffort(texto, REQUISITOS)).toThrow(/número finito/);
  });

  it.each([
    ['zero', 0],
    ['negativo', -8],
  ])('recusa horas %s', (_caso, valor) => {
    // Uma linha de -8 h reduziria o orçamento em silêncio.
    expect(() =>
      parseEffort(resposta(tarefa({ horasMin: valor })), REQUISITOS),
    ).toThrow(/maior que zero/);
  });

  it('recusa horas absurdas — o dígito a mais', () => {
    // `800` virando `8000` não parece errado numa lista de 30 linhas, mas
    // multiplica a proposta por dez.
    expect(() =>
      parseEffort(
        resposta(tarefa({ horasMin: 1, horasProvavel: 2, horasMax: MAX_HORAS_POR_TAREFA + 1 })),
        REQUISITOS,
      ),
    ).toThrow(/passa do limite/);
  });

  it.each(['requisito', 'tarefa', 'mvp'])(
    'recusa o campo de texto "%s" vazio',
    (campo) => {
      expect(() =>
        parseEffort(resposta(tarefa({ [campo]: '   ' })), REQUISITOS),
      ).toThrow(InvalidEffortError);
    },
  );

  it('recusa tarefa pendurada em requisito que não existe', () => {
    // Sem esta checagem, o modelo inventaria um requisito, a tarefa entraria na
    // conta, e o total ficaria maior por um trabalho que ninguém pediu.
    expect(() =>
      parseEffort(resposta(tarefa({ requisito: 'Blockchain' })), REQUISITOS),
    ).toThrow(/não está na lista aprovada/);
  });

  it('sem lista de requisitos conhecidos, não checa a origem', () => {
    // Caso real: a versão corrente de `requirements` foi editada à mão e o
    // `content` não tem a forma esperada. Barrar tudo aí seria pior — a
    // decomposição vira impossível por um detalhe de formato.
    const out = parseEffort(resposta(tarefa({ requisito: 'Qualquer coisa' })), []);
    expect(out.tarefas).toHaveLength(1);
  });

  it('aceita várias tarefas para o mesmo requisito', () => {
    const out = parseEffort(
      resposta(tarefa(), tarefa({ tarefa: 'Escrever testes do OAuth' })),
      REQUISITOS,
    );
    expect(out.tarefas).toHaveLength(2);
  });

  it('apara espaços em volta dos textos', () => {
    const out = parseEffort(
      resposta(tarefa({ requisito: '  Login com Google  ', tarefa: ' x ' })),
      REQUISITOS,
    );
    expect(out.tarefas[0].requisito).toBe('Login com Google');
    expect(out.tarefas[0].tarefa).toBe('x');
  });

  it('recusa tarefa que não é objeto', () => {
    expect(() => parseEffort(resposta('só um texto'), REQUISITOS)).toThrow(
      /não é objeto/,
    );
  });
});

describe('EffortEstimator: o schema não tem onde guardar um total', () => {
  it('descarta campos de soma que o modelo tenha inventado', () => {
    // A regra do §1: a IA decompõe, o código calcula. Proibir no prompt e
    // aceitar no schema deixaria a proibição valendo só enquanto o modelo
    // obedecesse — e um `totalHoras` vindo do modelo entraria numa proposta
    // comercial sem ninguém conferir a aritmética.
    const texto = JSON.stringify({
      tarefas: [tarefa()],
      totalHoras: 999,
      precoBrl: 123456,
    });
    const out = parseEffort(texto, REQUISITOS);
    expect(out).toEqual({ tarefas: [expect.objectContaining({ horasMin: 4 })] });
    expect(out as unknown as Record<string, unknown>).not.toHaveProperty('totalHoras');
    expect(out as unknown as Record<string, unknown>).not.toHaveProperty('precoBrl');
  });

  it('o prompt proíbe somar, em português', () => {
    // O texto é contrato: se alguém reescrever o prompt e remover a proibição,
    // o modelo volta a somar — e o schema, sozinho, só descarta em silêncio.
    expect(EFFORT_SYSTEM).toMatch(/NÃO some nada/);
    expect(EFFORT_SYSTEM).toMatch(/NÃO calcule totais/);
    expect(EFFORT_SYSTEM).toMatch(/horasMin <= horasProvavel <= horasMax/);
  });
});

describe('requisitosSemTarefa: a lacuna que se anota, não se bloqueia', () => {
  it('aponta o requisito sem nenhuma tarefa', () => {
    const out = parseEffort(resposta(tarefa()), REQUISITOS);
    expect(requisitosSemTarefa(out, REQUISITOS)).toEqual(['Painel do cliente']);
  });

  it('devolve vazio quando todos foram cobertos', () => {
    const out = parseEffort(
      resposta(tarefa(), tarefa({ requisito: 'Painel do cliente' })),
      REQUISITOS,
    );
    expect(requisitosSemTarefa(out, REQUISITOS)).toEqual([]);
  });
});

describe('titulosDeRequisitos: leitura defensiva do jsonb', () => {
  it('extrai os títulos de um content bem formado', () => {
    expect(
      titulosDeRequisitos({
        requisitos: [
          { titulo: 'Login com Google', descricao: 'x', prioridade: 'essencial' },
          { titulo: 'Painel do cliente', descricao: 'y', prioridade: 'importante' },
        ],
      }),
    ).toEqual(REQUISITOS);
  });

  it.each([
    ['null', null],
    ['string', 'requisitos'],
    ['sem o campo', { outra: [] }],
    ['campo que não é lista', { requisitos: 'x' }],
  ])('devolve vazio para content inválido: %s', (_caso, content) => {
    // Vazio e não exceção: a versão corrente pode ser `human` (§2.10 da
    // SPEC-032) e edição à mão não passa por schema nenhum.
    expect(titulosDeRequisitos(content)).toEqual([]);
  });

  it('ignora itens sem título utilizável', () => {
    expect(
      titulosDeRequisitos({
        requisitos: [{ titulo: 'Bom' }, { titulo: '  ' }, { titulo: 42 }, null],
      }),
    ).toEqual(['Bom']);
  });
});

describe('buildEffortUser', () => {
  it('manda os requisitos e nada além disso', () => {
    const user = buildEffortUser({ requisitos: [{ titulo: 'Login com Google' }] });
    expect(user).toContain('Requisitos aprovados');
    expect(user).toContain('Login com Google');
  });
});
