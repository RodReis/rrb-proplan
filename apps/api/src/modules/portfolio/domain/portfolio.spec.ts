import {
  assemblePortfolio,
  PortfolioInput,
  rankByRisk,
} from './portfolio';

const red = (): { red: boolean; observedAt: string | null } => ({
  red: true,
  observedAt: '2026-07-15T00:00:00.000Z',
});
const green = (): { red: boolean; observedAt: string | null } => ({
  red: false,
  observedAt: '2026-07-15T00:00:00.000Z',
});

function proj(over: Partial<PortfolioInput>): PortfolioInput {
  return {
    projectId: over.projectId ?? 'p',
    name: over.name ?? 'repo',
    owner: over.owner ?? 'me',
    stalenessDays: over.stalenessDays ?? null,
    staleness: over.staleness ?? null,
    coverage: over.coverage ?? null,
    deploy: over.deploy ?? null,
    ci: over.ci ?? null,
    revalidate: over.revalidate,
    blockers: over.blockers,
  };
}

describe('assemblePortfolio', () => {
  it('conta os 4 sinais entregues em vermelho', () => {
    const [row] = assemblePortfolio([
      proj({ staleness: red(), coverage: red(), deploy: green(), ci: red() }),
    ]);
    expect(row.redCount).toBe(3);
  });

  it('sinal ausente (null) não conta', () => {
    const [row] = assemblePortfolio([proj({ staleness: red() })]);
    expect(row.redCount).toBe(1);
  });

  it('slots de 10/11 são peso-zero: red não entra na conta', () => {
    const [row] = assemblePortfolio([
      proj({ revalidate: red(), blockers: red() }),
    ]);
    expect(row.redCount).toBe(0);
  });

  it('não quebra na ausência dos slots (undefined)', () => {
    const [row] = assemblePortfolio([proj({ ci: red() })]);
    expect(row.redCount).toBe(1);
  });
});

describe('rankByRisk', () => {
  it('ordena por contagem de vermelhos, desc', () => {
    const rows = assemblePortfolio([
      proj({ name: 'a', ci: red() }),
      proj({ name: 'b', staleness: red(), coverage: red(), deploy: red() }),
      proj({ name: 'c' }),
    ]);
    const order = rankByRisk(rows).map((r) => r.name);
    expect(order).toEqual(['b', 'a', 'c']);
  });

  it('desempata por staleness (maior primeiro)', () => {
    const rows = assemblePortfolio([
      proj({ name: 'a', ci: red(), stalenessDays: 10 }),
      proj({ name: 'b', ci: red(), stalenessDays: 200 }),
    ]);
    expect(rankByRisk(rows).map((r) => r.name)).toEqual(['b', 'a']);
  });

  it('é determinístico: 2× sobre o mesmo estado → mesma ordem', () => {
    const rows = assemblePortfolio([
      proj({ name: 'z', ci: red() }),
      proj({ name: 'a', ci: red() }),
      proj({ name: 'm', staleness: red(), ci: red() }),
    ]);
    const first = rankByRisk(rows).map((r) => r.projectId + r.name);
    const second = rankByRisk(rows).map((r) => r.projectId + r.name);
    expect(first).toEqual(second);
  });

  it('não muta a entrada', () => {
    const rows = assemblePortfolio([
      proj({ name: 'b', ci: red() }),
      proj({ name: 'a' }),
    ]);
    const before = rows.map((r) => r.name);
    rankByRisk(rows);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});
