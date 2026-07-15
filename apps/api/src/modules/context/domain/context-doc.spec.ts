import {
  ContextAssertion,
  parseContextMd,
  revalidationStatus,
  serializeContextMd,
} from './context-doc';

const FULL: ContextAssertion = {
  statement: 'Não refatorar o motor de folha v1 antes do corte com o contador',
  paths: ['lib/folha/engine/', 'supabase/migrations/202606130005_drop.sql'],
  author: 'rodrigo',
  date: '2026-06-12',
  sha: 'a1b2c3d',
  status: 'vigente',
  body: 'O drop é irreversível e depende de validação fiscal com 2-3 contracheques reais.',
};

describe('parseContextMd / serializeContextMd', () => {
  it('round-trip: parse(serialize(x)) == x (critério de aceite)', () => {
    const input: ContextAssertion[] = [
      FULL,
      {
        statement: 'Esse módulo parece morto e não é',
        paths: ['apps/api/src/legacy/'],
        author: 'rodrigo',
        date: '2026-07-01',
        sha: 'deadbee',
        status: 'a-revalidar',
        body: '',
      },
    ];
    const { assertions, warnings } = parseContextMd(serializeContextMd(input));
    expect(assertions).toEqual(input);
    expect(warnings).toEqual([]);
  });

  it('parseia o exemplo da SPEC-015 (com frontmatter e título)', () => {
    const md = [
      '---',
      'proplan: v2',
      '---',
      '# Contexto — o que não mexer',
      '',
      '## Não refatorar o motor de folha v1',
      '- paths: lib/folha/engine/',
      '- autor: rodrigo',
      '- data: 2026-06-12',
      '- sha: a1b2c3d',
      '- status: vigente',
      '',
      'O drop é irreversível.',
    ].join('\n');
    const { assertions } = parseContextMd(md);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].statement).toBe('Não refatorar o motor de folha v1');
    expect(assertions[0].paths).toEqual(['lib/folha/engine/']);
    expect(assertions[0].body).toBe('O drop é irreversível.');
  });

  it('edição humana: campos ausentes degradam com warning, nunca quebram', () => {
    const md = '## Só o texto, sem campo nenhum\n\nCorpo escrito à mão.';
    const { assertions, warnings } = parseContextMd(md);
    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatchObject({
      statement: 'Só o texto, sem campo nenhum',
      paths: [],
      author: '',
      date: '',
      status: 'vigente',
      body: 'Corpo escrito à mão.',
    });
    expect(warnings.some((w) => w.includes('sem paths'))).toBe(true);
    expect(warnings.some((w) => w.includes('sem data'))).toBe(true);
  });

  it('data inválida vira warning e campo vazio', () => {
    const md = '## X\n- paths: a\n- autor: r\n- data: ontem\n- sha: s\n- status: vigente';
    const { assertions, warnings } = parseContextMd(md);
    expect(assertions[0].date).toBe('');
    expect(warnings.some((w) => w.includes('data inválida'))).toBe(true);
  });

  it('status desconhecido no arquivo cai em vigente (derivado na ingestão)', () => {
    const md = '## X\n- paths: a\n- autor: r\n- data: 2026-01-01\n- sha: s\n- status: qualquer';
    expect(parseContextMd(md).assertions[0].status).toBe('vigente');
  });

  it('arquivo vazio ou null → zero asserções, zero warnings', () => {
    expect(parseContextMd(null)).toEqual({ assertions: [], warnings: [] });
    expect(parseContextMd('  \n')).toEqual({ assertions: [], warnings: [] });
  });

  it('serialize escreve frontmatter v2 e o título canônico', () => {
    const out = serializeContextMd([FULL]);
    expect(out.startsWith('---\nproplan: v2\n---\n# Contexto — o que não mexer')).toBe(true);
  });
});

describe('revalidationStatus', () => {
  it('commit em path citado DEPOIS da data → a-revalidar', () => {
    expect(
      revalidationStatus('2026-06-12', [new Date('2026-07-01T10:00:00Z')]),
    ).toBe('a-revalidar');
  });

  it('nenhum commit depois da data → vigente', () => {
    expect(
      revalidationStatus('2026-06-12', [new Date('2026-06-01T10:00:00Z'), null]),
    ).toBe('vigente');
  });

  it('commit no MESMO dia da captura não rebaixa', () => {
    expect(
      revalidationStatus('2026-06-12', [new Date('2026-06-12T18:00:00Z')]),
    ).toBe('vigente');
  });

  it('sem data (edição humana degradada) → mantém vigente', () => {
    expect(revalidationStatus('', [new Date()])).toBe('vigente');
  });

  it('path sem commit (null) não rebaixa', () => {
    expect(revalidationStatus('2026-06-12', [null])).toBe('vigente');
  });
});
