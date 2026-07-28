import {
  formatAddress,
  formatBrlFromDecimalString,
  formatDateLong,
  formatHoursFromDecimalString,
  parseProvavel,
  parseScope,
  scopeToMarkup,
} from './snapshot';

describe('formatBrlFromDecimalString', () => {
  it('formata o texto do Decimal com milhares e centavos', () => {
    expect(formatBrlFromDecimalString('12345.60')).toBe('R$ 12.345,60');
    expect(formatBrlFromDecimalString('1000000.05')).toBe('R$ 1.000.000,05');
    expect(formatBrlFromDecimalString('0.50')).toBe('R$ 0,50');
  });

  it('completa os centavos quando o texto vem sem eles', () => {
    expect(formatBrlFromDecimalString('120')).toBe('R$ 120,00');
    expect(formatBrlFromDecimalString('120.5')).toBe('R$ 120,50');
  });

  it('NÃO passa por Number — centavo além do double sobrevive', () => {
    // O ponto inteiro do §6: `Number('12345678901234567.89')` perde precisão
    // silenciosamente. O contrato tem de imprimir o que o `Estimate` congelou.
    expect(formatBrlFromDecimalString('12345678901234567.89')).toBe(
      'R$ 12.345.678.901.234.567,89',
    );
  });

  it('devolve o texto original quando não é decimal — erra em voz alta', () => {
    expect(formatBrlFromDecimalString('n/d')).toBe('n/d');
    expect(formatBrlFromDecimalString('')).toBe('');
  });
});

describe('formatHoursFromDecimalString', () => {
  it('corta os zeros à direita', () => {
    expect(formatHoursFromDecimalString('120.00')).toBe('120');
    expect(formatHoursFromDecimalString('1.50')).toBe('1,5');
    expect(formatHoursFromDecimalString('1234.25')).toBe('1.234,25');
  });

  it('devolve o texto original quando não é decimal', () => {
    expect(formatHoursFromDecimalString('muitas')).toBe('muitas');
  });
});

describe('formatAddress', () => {
  it('junta o que existe, sem vírgula órfã', () => {
    expect(
      formatAddress({ street: 'Rua A, 100', city: 'Porto Alegre', state: 'RS', zipCode: '90000-000' }),
    ).toBe('Rua A, 100, Porto Alegre, RS — CEP 90000-000');
  });

  it('campo ausente some em vez de virar espaço entre vírgulas', () => {
    expect(formatAddress({ street: 'Rua A', city: null, state: undefined })).toBe('Rua A');
  });

  it('só CEP não vira uma linha começando com travessão', () => {
    expect(formatAddress({ zipCode: '90000-000' })).toBe('CEP 90000-000');
  });

  it('endereço inteiramente vazio vira string vazia', () => {
    expect(formatAddress({})).toBe('');
  });
});

describe('parseScope', () => {
  it('lê as quatro listas', () => {
    expect(
      parseScope({ entregaveis: ['a'], foraDeEscopo: ['b'], premissas: ['c'], riscos: ['d'] }),
    ).toEqual({ entregaveis: ['a'], foraDeEscopo: ['b'], premissas: ['c'], riscos: ['d'] });
  });

  it('conteúdo editado à mão não derruba a emissão', () => {
    // O `content` vem do `jsonb` e pode ter sido editado (§2.10 da SPEC-032).
    // Campo ausente ou com tipo errado vira lista vazia — não `TypeError`.
    expect(parseScope({ entregaveis: 'texto', riscos: [1, 'ok'] })).toEqual({
      entregaveis: [],
      foraDeEscopo: [],
      premissas: [],
      riscos: ['ok'],
    });
    expect(parseScope(null)).toEqual({
      entregaveis: [],
      foraDeEscopo: [],
      premissas: [],
      riscos: [],
    });
  });
});

describe('scopeToMarkup', () => {
  it('monta título e lista por seção', () => {
    const markup = scopeToMarkup({
      entregaveis: ['API', 'Painel'],
      foraDeEscopo: [],
      premissas: [],
      riscos: [],
    });
    expect(markup).toBe('**Entregáveis**\n\n- API\n- Painel');
  });

  it('escapa item por item — o escopo nasce do briefing do CLIENTE', () => {
    // `{{scope}}` não é reescapado pelo renderizador (é `MARKUP_PLACEHOLDERS`,
    // porque carrega `-` e `**` próprios). Sem o escape aqui, um entregável
    // com `<script>` viraria tag na página pública.
    const markup = scopeToMarkup({
      entregaveis: ['<script>alert(1)</script>'],
      foraDeEscopo: [],
      premissas: [],
      riscos: [],
    });
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
  });

  it('seção vazia SOME — lista vazia sugeriria que ninguém preencheu', () => {
    const markup = scopeToMarkup({
      entregaveis: ['API'],
      foraDeEscopo: [],
      premissas: ['acesso ao repo'],
      riscos: [],
    });
    expect(markup).toContain('**Premissas**');
    expect(markup).not.toContain('**Riscos**');
    expect(markup).not.toContain('**Fora de escopo**');
  });
});

describe('parseProvavel', () => {
  it('lê o cenário provável como STRING, sem converter', () => {
    expect(
      parseProvavel({
        otimista: { horas: '90.00', totalBrl: '9000.00' },
        provavel: { horas: '120.00', totalBrl: '12000.00' },
      }),
    ).toEqual({ horas: '120.00', totalBrl: '12000.00' });
  });

  it('cenário ausente vira vazio em vez de quebrar', () => {
    expect(parseProvavel(null)).toEqual({ horas: '', totalBrl: '' });
    expect(parseProvavel({ provavel: { horas: 120 } })).toEqual({ horas: '', totalBrl: '' });
  });
});

describe('formatDateLong', () => {
  it('escreve a data por extenso', () => {
    expect(formatDateLong(new Date(2026, 6, 28))).toBe('28 de julho de 2026');
  });
});
