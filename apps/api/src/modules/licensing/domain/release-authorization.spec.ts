import { latestAuthorized, latestOverall } from './release-authorization';

/**
 * A regra que prova a promessa da licença perpétua (SPEC-041 §Critérios de
 * aceite). Função pura, então os casos que importam são de fronteira.
 */

const r = (version: string, releasedAt: string) => ({
  version,
  releasedAt: new Date(releasedAt),
});

describe('latestAuthorized', () => {
  it('janela no futuro devolve a release corrente', () => {
    const releases = [r('1.0.0', '2026-01-10'), r('1.2.0', '2026-06-01')];

    expect(latestAuthorized(releases, new Date('2027-01-01'))?.version).toBe('1.2.0');
  });

  it('janela vencida devolve a ÚLTIMA AUTORIZADA, não a corrente', () => {
    // **O critério que prova a promessa da licença perpétua.** Quem parou de
    // pagar update continua baixando o que já tinha direito; só não recebe o que
    // veio depois. Responder a corrente daria de graça o que não foi comprado;
    // responder `null` tiraria o que já era dele.
    const releases = [
      r('1.0.0', '2026-01-10'),
      r('1.1.0', '2026-03-01'),
      r('2.0.0', '2026-09-01'),
    ];

    expect(latestAuthorized(releases, new Date('2026-06-30'))?.version).toBe('1.1.0');
  });

  it('release publicada NO instante do vencimento está autorizada (`>=`)', () => {
    // `>` puniria o cliente por um empate de timestamp. A fronteira do que ele
    // comprou é o próprio `updatesUntil`, inclusive.
    const instante = '2026-06-30T12:00:00.000Z';

    expect(latestAuthorized([r('1.1.0', instante)], new Date(instante))?.version).toBe(
      '1.1.0',
    );
  });

  it('nenhuma release cabe na janela devolve null', () => {
    expect(latestAuthorized([r('2.0.0', '2026-09-01')], new Date('2026-01-01'))).toBeNull();
  });

  it('lista vazia devolve null', () => {
    expect(latestAuthorized([], new Date('2026-06-30'))).toBeNull();
  });

  it('não depende da ordem da entrada', () => {
    // Depender do `orderBy` do `findMany` faria a corretude desta função morar
    // noutro arquivo — e um `orderBy` alterado por engano viraria autorização
    // errada, sem nenhum teste falhando aqui.
    const desordenada = [
      r('2.0.0', '2026-09-01'),
      r('1.0.0', '2026-01-10'),
      r('1.1.0', '2026-03-01'),
    ];

    expect(latestAuthorized(desordenada, new Date('2026-06-30'))?.version).toBe('1.1.0');
  });
});

describe('latestOverall', () => {
  it('devolve a mais nova, autorizada ou não', () => {
    // É o que permite distinguir `current` de `last-authorized`: sem isto o
    // cliente ouviria "você está atualizado" tendo parado de receber versões.
    const releases = [r('1.1.0', '2026-03-01'), r('2.0.0', '2026-09-01')];

    expect(latestOverall(releases)?.version).toBe('2.0.0');
  });

  it('lista vazia devolve null', () => {
    expect(latestOverall([])).toBeNull();
  });
});
