import { SlidingWindowRateLimiter } from './rate-limiter';

describe('rate limit da rota pública (SPEC-029)', () => {
  const WINDOW = 60_000;

  it('permite até o limite e barra o excedente', () => {
    const limiter = new SlidingWindowRateLimiter(3, WINDOW);
    const t = 1_000_000;

    expect(limiter.check('ip:tok', t).allowed).toBe(true);
    expect(limiter.check('ip:tok', t + 1).allowed).toBe(true);
    expect(limiter.check('ip:tok', t + 2).allowed).toBe(true);
    // 4ª na mesma janela → barrada (é o 429 do critério de aceite).
    expect(limiter.check('ip:tok', t + 3).allowed).toBe(false);
  });

  it('a janela desliza: passado o tempo, libera de novo', () => {
    const limiter = new SlidingWindowRateLimiter(2, WINDOW);
    const t = 1_000_000;

    limiter.check('k', t);
    limiter.check('k', t + 1);
    expect(limiter.check('k', t + 2).allowed).toBe(false);
    // Depois da janela, os hits antigos saem da conta.
    expect(limiter.check('k', t + WINDOW + 1).allowed).toBe(true);
  });

  it('chaves diferentes não se afetam (IP+token isola)', () => {
    const limiter = new SlidingWindowRateLimiter(1, WINDOW);
    const t = 1_000_000;

    expect(limiter.check('ip1:tokA', t).allowed).toBe(true);
    expect(limiter.check('ip1:tokA', t).allowed).toBe(false);
    // Outro token do mesmo IP, e outro IP do mesmo token, seguem livres — quem
    // recarrega o próprio link não é punido por vizinho barulhento.
    expect(limiter.check('ip1:tokB', t).allowed).toBe(true);
    expect(limiter.check('ip2:tokA', t).allowed).toBe(true);
  });

  it('retryAfter aponta para quando a janela abre, nunca zero', () => {
    const limiter = new SlidingWindowRateLimiter(1, WINDOW);
    const t = 1_000_000;

    limiter.check('k', t);
    const denied = limiter.check('k', t + 10_000);
    expect(denied.allowed).toBe(false);
    // Faltam 50s para o hit original sair da janela.
    expect(denied.retryAfterSeconds).toBe(50);
  });

  it('prune descarta chaves cuja janela já passou (não vaza memória)', () => {
    const limiter = new SlidingWindowRateLimiter(5, WINDOW);
    const t = 1_000_000;

    limiter.check('velha', t);
    limiter.check('nova', t + WINDOW);
    expect(limiter.size).toBe(2);

    limiter.prune(t + WINDOW + 1);
    // Sem isto, cada IP novo deixaria uma entrada órfã para sempre.
    expect(limiter.size).toBe(1);
    expect(limiter.check('nova', t + WINDOW + 1).allowed).toBe(true);
  });

  it('barrar não estende a punição indefinidamente', () => {
    const limiter = new SlidingWindowRateLimiter(1, WINDOW);
    const t = 1_000_000;

    limiter.check('k', t);
    // Marteladas dentro da janela são barradas, mas NÃO devem virar hits novos
    // que empurrem a liberação para frente (senão quem insiste nunca sai).
    for (let i = 1; i <= 10; i++) limiter.check('k', t + i);
    expect(limiter.check('k', t + WINDOW + 1).allowed).toBe(true);
  });
});
