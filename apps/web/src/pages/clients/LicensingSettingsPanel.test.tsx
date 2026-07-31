import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  getLicensingSettings: vi.fn(),
  getSourceSettings: vi.fn(),
  updateLicensingSettings: vi.fn(),
  setSourcePat: vi.fn(),
  testSourceConnection: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { LicensingSettingsPanel } = await import('./LicensingSettingsPanel');

/**
 * A aba Configurações do licenciamento — os três ajustes reunidos (decisão do
 * PI, 2026-07-31): segredo do webhook, tolerância de inadimplência e PAT do
 * GitHub.
 *
 * O que se testa não é layout: é **o que a tela afirma**. Os dois segredos são
 * write-only, e "configurado" nunca pode ser lido como "funciona" — PAT
 * fine-grained expira, e é o teste de conexão que antecipa a falha.
 */
beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getLicensingSettings.mockResolvedValue({
    webhookSecretSet: true,
    pastDueToleranceDays: 15,
  });
  apiMock.getSourceSettings.mockResolvedValue({
    githubPatSet: true,
    sourceRepo: 'RodReis/wr',
  });
});

describe('PAT write-only e teste de conexão', () => {
  it('o campo é do tipo password e o valor nunca vem da API', async () => {
    render(<LicensingSettingsPanel />);

    const campo = await screen.findByLabelText(/pat do github/i);
    expect(campo).toHaveAttribute('type', 'password');
    // O `GET` devolve só `githubPatSet` — não há valor para preencher.
    expect(campo).toHaveValue('');
  });

  it('configurado não afirma que funciona — aponta o teste', async () => {
    render(<LicensingSettingsPanel />);

    // PAT fine-grained expira; "tudo ok" esconderia a falha que o teste antecipa.
    expect(await screen.findByText(/expira/)).toBeInTheDocument();
    expect(screen.getByText(/teste de conexão/)).toBeInTheDocument();
  });

  it('testar conexão com falha mostra o motivo, sem quebrar', async () => {
    const user = userEvent.setup();
    apiMock.testSourceConnection.mockResolvedValue({
      ok: false,
      reason: 'o token não tem permissão de administração no repositório',
    });

    render(<LicensingSettingsPanel />);
    await user.click(await screen.findByRole('button', { name: /testar conexão/i }));

    // `ok: false` é o RESULTADO, não uma exceção: um PAT só-leitura enxerga o repo
    // e não convida ninguém, e é exatamente isso que o teste existe para pegar
    // antes da primeira venda.
    expect(
      await screen.findByText(/Falhou: o token não tem permissão de administração/),
    ).toBeInTheDocument();
  });

  it('testar conexão OK nomeia o repo', async () => {
    const user = userEvent.setup();
    apiMock.testSourceConnection.mockResolvedValue({ ok: true, repo: 'RodReis/war-room' });

    render(<LicensingSettingsPanel />);
    await user.click(await screen.findByRole('button', { name: /testar conexão/i }));

    expect(await screen.findByText(/administra RodReis\/war-room/)).toBeInTheDocument();
  });

  it('teste bem-sucedido RECARREGA as settings — FIX #214', async () => {
    const user = userEvent.setup();
    // Estado do bug: o painel montou antes de o repo ser salvo no bloco de
    // produtos, então `sourceRepo` está `null` em memória.
    apiMock.getSourceSettings.mockResolvedValue({ githubPatSet: true, sourceRepo: null });
    apiMock.testSourceConnection.mockResolvedValue({ ok: true, repo: 'RodReis/war-room' });

    render(<LicensingSettingsPanel />);
    await screen.findByRole('button', { name: /testar conexão/i });
    // Depois do teste, o servidor já sabe do repo.
    apiMock.getSourceSettings.mockResolvedValue({
      githubPatSet: true,
      sourceRepo: 'RodReis/war-room',
    });

    await user.click(screen.getByRole('button', { name: /testar conexão/i }));

    // **O bug**: a frase dizia "nenhum produto tem repositório configurado" ao
    // lado de um teste que acabara de administrar aquele repositório. Das duas
    // afirmações contraditórias, a assustadora era a falsa — e é assim que uma
    // tela ensina a ser ignorada.
    await waitFor(() =>
      expect(screen.queryByText(/nenhum produto tem repositório/i)).not.toBeInTheDocument(),
    );
    expect(apiMock.getSourceSettings).toHaveBeenCalledTimes(2);
  });

  it('testar fica desabilitado sem PAT configurado', async () => {
    apiMock.getSourceSettings.mockResolvedValue({ githubPatSet: false, sourceRepo: null });

    render(<LicensingSettingsPanel />);

    expect(await screen.findByRole('button', { name: /testar conexão/i })).toBeDisabled();
  });

  it('salvar PAT limpa o campo e manda testar', async () => {
    const user = userEvent.setup();
    apiMock.setSourcePat.mockResolvedValue({ githubPatSet: true, sourceRepo: 'RodReis/wr' });

    render(<LicensingSettingsPanel />);
    const campo = await screen.findByLabelText(/pat do github/i);
    await user.type(campo, 'github_pat_abc');
    await user.click(screen.getByRole('button', { name: /salvar pat/i }));

    await waitFor(() => expect(apiMock.setSourcePat).toHaveBeenCalledWith('github_pat_abc'));
    // Não deixa o segredo no DOM depois de salvo.
    expect(campo).toHaveValue('');
    expect(toastMock.success).toHaveBeenCalledWith(expect.stringMatching(/teste de conexão/));
  });
});

describe('configuração', () => {
  /** O ponto de segurança: o valor do segredo nunca chega à tela. */
  it('nunca exibe o segredo — só diz que está configurado', async () => {
    render(<LicensingSettingsPanel />);

    expect(await screen.findByText(/O valor não é exibido/i)).toBeInTheDocument();
    // O campo é de senha, e está vazio: ele serve para GRAVAR, não para ler.
    const campo = screen.getByLabelText('Segredo do webhook') as HTMLInputElement;
    expect(campo.type).toBe('password');
    expect(campo.value).toBe('');
  });

  it('sem segredo, avisa que toda entrega responde 401', async () => {
    apiMock.getLicensingSettings.mockResolvedValue({
      webhookSecretSet: false,
      pastDueToleranceDays: 15,
    });

    render(<LicensingSettingsPanel />);

    expect(await screen.findByText(/responde 401/i)).toBeInTheDocument();
  });

  it('descreve o efeito da tolerância, não o número solto', async () => {
    render(<LicensingSettingsPanel />);

    expect(
      await screen.findByText(/Corta 15 dias depois do aviso de atraso/i),
    ).toBeInTheDocument();
  });

  /**
   * A decisão PI #3 na tela: `null` é "nunca corta", não campo vazio. Se
   * aparecesse como `—`, alguém iria "consertar" configurando — e ligaria um
   * corte que o dono desligou de propósito.
   */
  it('com tolerância null, diz que o ProPlan nunca corta', async () => {
    apiMock.getLicensingSettings.mockResolvedValue({
      webhookSecretSet: true,
      pastDueToleranceDays: null,
    });

    render(<LicensingSettingsPanel />);

    expect(await screen.findByText(/nunca corta por atraso/i)).toBeInTheDocument();
    // Já desligado: o botão de desligar não se repete.
    expect(
      screen.queryByRole('button', { name: /Desligar o corte/i }),
    ).toBeNull();
  });

  /** A mitigação sem deploy do risco aceito precisa estar alcançável. */
  it('desligar o corte manda null explícito', async () => {
    apiMock.updateLicensingSettings.mockResolvedValue({
      webhookSecretSet: true,
      pastDueToleranceDays: null,
    });

    render(<LicensingSettingsPanel />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Desligar o corte/i }),
    );

    expect(apiMock.updateLicensingSettings).toHaveBeenCalledWith({
      pastDueToleranceDays: null,
    });
  });

  it('salvar dias manda só a tolerância, sem tocar o segredo', async () => {
    apiMock.updateLicensingSettings.mockResolvedValue({
      webhookSecretSet: true,
      pastDueToleranceDays: 30,
    });

    render(<LicensingSettingsPanel />);
    await userEvent.type(await screen.findByLabelText('Dias de tolerância'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar dias' }));

    const enviado = apiMock.updateLicensingSettings.mock.calls[0][0];
    expect(enviado).toEqual({ pastDueToleranceDays: 30 });
    expect('webhookSecret' in enviado).toBe(false);
  });

  it('salvar segredo manda só o segredo, sem tocar a tolerância', async () => {
    apiMock.updateLicensingSettings.mockResolvedValue({
      webhookSecretSet: true,
      pastDueToleranceDays: 15,
    });

    render(<LicensingSettingsPanel />);
    await userEvent.type(
      await screen.findByLabelText('Segredo do webhook'),
      'tok-da-kiwify',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salvar segredo' }));

    const enviado = apiMock.updateLicensingSettings.mock.calls[0][0];
    expect(enviado).toEqual({ webhookSecret: 'tok-da-kiwify' });
    expect('pastDueToleranceDays' in enviado).toBe(false);
  });
});
