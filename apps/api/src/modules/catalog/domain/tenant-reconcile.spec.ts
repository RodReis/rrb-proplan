import {
  reconcileTenantInstallations,
  TenantInstallationState,
  VisibleInstallation,
} from './tenant-reconcile';

const tenant = (
  over: Partial<TenantInstallationState> = {},
): TenantInstallationState => ({
  id: 't1',
  installationId: 100,
  accountId: 55,
  accountLogin: 'RodReis',
  ...over,
});

const installation = (
  over: Partial<VisibleInstallation> = {},
): VisibleInstallation => ({
  installationId: 100,
  accountId: 55,
  accountLogin: 'RodReis',
  ...over,
});

describe('reconcileTenantInstallations', () => {
  it('reinstall (installationId novo, mesma conta) → RE-APONTA o mesmo tenant', () => {
    // O teste que prova a fatia: o GitHub emitiu 200 no lugar de 100, mas a
    // conta é a mesma. Tem de sair um relink do tenant EXISTENTE — nunca um
    // tenant novo (que orfanaria projetos e settings do antigo).
    const out = reconcileTenantInstallations(
      [tenant({ installationId: 100 })],
      [installation({ installationId: 200 })],
    );
    expect(out).toEqual([
      { tenantId: 't1', installationId: 200, accountId: 55, accountLogin: 'RodReis' },
    ]);
  });

  it('sem mudança → nenhum update', () => {
    expect(reconcileTenantInstallations([tenant()], [installation()])).toEqual([]);
  });

  it('rename da conta não cria tenant novo — casa por accountId e atualiza o login', () => {
    // A razão de existir do accountId: casar por accountLogin aqui devolveria
    // "não achei" e o chamador criaria um tenant duplicado.
    const out = reconcileTenantInstallations(
      [tenant({ accountLogin: 'RodReis' })],
      [installation({ accountLogin: 'rodrigo-reis' })],
    );
    expect(out).toEqual([
      {
        tenantId: 't1',
        installationId: 100,
        accountId: 55,
        accountLogin: 'rodrigo-reis',
      },
    ]);
  });

  it('linha pré-migration (accountId nulo) casa por login e ganha o accountId', () => {
    const out = reconcileTenantInstallations(
      [tenant({ accountId: null, installationId: null })],
      [installation()],
    );
    expect(out).toEqual([
      { tenantId: 't1', installationId: 100, accountId: 55, accountLogin: 'RodReis' },
    ]);
  });

  it('casamento por login é case-insensitive (GitHub não diferencia)', () => {
    const out = reconcileTenantInstallations(
      [tenant({ accountId: null, accountLogin: 'rodreis' })],
      [installation({ accountLogin: 'RodReis' })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].accountId).toBe(55);
  });

  it('tenant sem instalação visível fica INTACTO (ausência ≠ removido)', () => {
    // Não ver a instalação agora pode ser falta de permissão, token de outro
    // usuário ou App removido. Nenhum desses justifica orfanar os dados.
    expect(reconcileTenantInstallations([tenant()], [])).toEqual([]);
  });

  it('conta diferente não é casada (nem por id, nem por login)', () => {
    const out = reconcileTenantInstallations(
      [tenant({ accountId: 55, accountLogin: 'RodReis' })],
      [installation({ accountId: 99, accountLogin: 'outra-conta' })],
    );
    expect(out).toEqual([]);
  });

  it('linha pré-migration com login AMBÍGUO não casa (não chuta a conta)', () => {
    // O buraco que o code review pegou: o teste de homônimo abaixo usa
    // accountId preenchido, então exercita o byAccountId — NÃO o fallback.
    // Aqui a linha é pré-migration (accountId null), que é justamente quando
    // o fallback por login manda. Duas instalações normalizam para o mesmo
    // login: pegar "a última" re-apontaria o tenant para a instalação de outra
    // conta. Sem certeza, não mexe.
    const out = reconcileTenantInstallations(
      [tenant({ accountId: null, accountLogin: 'RodReis' })],
      [
        installation({ accountId: 55, accountLogin: 'RodReis', installationId: 100 }),
        installation({ accountId: 99, accountLogin: 'rodreis', installationId: 900 }),
      ],
    );
    expect(out).toEqual([]);
  });

  it('accountId vence o login: mesma conta renomeada não casa com homônimo alheio', () => {
    // Cenário real de rename: o login "RodReis" foi liberado e outra conta o
    // tomou. Casar por login pegaria a conta ERRADA e re-apontaria o tenant
    // para a instalação de um terceiro — vazamento entre tenants.
    const out = reconcileTenantInstallations(
      [tenant({ accountId: 55, accountLogin: 'RodReis' })],
      [
        installation({ accountId: 99, accountLogin: 'RodReis', installationId: 900 }),
        installation({ accountId: 55, accountLogin: 'rodrigo-reis', installationId: 200 }),
      ],
    );
    expect(out).toEqual([
      {
        tenantId: 't1',
        installationId: 200,
        accountId: 55,
        accountLogin: 'rodrigo-reis',
      },
    ]);
  });
});
