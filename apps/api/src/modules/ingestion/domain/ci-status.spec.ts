import { ciIsRed, ciStatusOf } from './ci-status';

describe('ciStatusOf', () => {
  it('sem permissão Actions → sem-ci', () => {
    expect(
      ciStatusOf({ status: null, conclusion: null, denied: true }),
    ).toBe('sem-ci');
  });

  it('repo sem run → sem-run', () => {
    expect(
      ciStatusOf({ status: null, conclusion: null, denied: false }),
    ).toBe('sem-run');
  });

  it('run em andamento → em-andamento', () => {
    expect(
      ciStatusOf({ status: 'in_progress', conclusion: null, denied: false }),
    ).toBe('em-andamento');
  });

  it('run concluído → a própria conclusion', () => {
    expect(
      ciStatusOf({ status: 'completed', conclusion: 'success', denied: false }),
    ).toBe('success');
    expect(
      ciStatusOf({ status: 'completed', conclusion: 'failure', denied: false }),
    ).toBe('failure');
  });
});

describe('ciIsRed', () => {
  it('failure/timed_out/cancelled são vermelho', () => {
    expect(ciIsRed('failure')).toBe(true);
    expect(ciIsRed('timed_out')).toBe(true);
    expect(ciIsRed('cancelled')).toBe(true);
  });

  it('sucesso e ausência de CI NÃO são vermelho', () => {
    expect(ciIsRed('success')).toBe(false);
    expect(ciIsRed('sem-ci')).toBe(false);
    expect(ciIsRed('sem-run')).toBe(false);
    expect(ciIsRed('em-andamento')).toBe(false);
    expect(ciIsRed(null)).toBe(false);
  });
});
