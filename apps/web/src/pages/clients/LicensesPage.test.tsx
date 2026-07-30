import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../theme';
import type { LicCatalogResponse, LicenseView } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  getLicensingCatalog: vi.fn(),
  listLicenses: vi.fn(),
  issueLicense: vi.fn(),
  revokeLicense: vi.fn(),
  listLicenseEvents: vi.fn(),
  createLicProduct: vi.fn(),
  createLicEdition: vi.fn(),
  // SPEC-037
  getLicenseDetail: vi.fn(),
  deactivateActivation: vi.fn(),
  // SPEC-038 PR-5 — o `WebhookOpsPanel` é filho desta página e carrega no
  // mount. Sem estes mocks as três chamadas cairiam no `request` real: sem
  // erro visível no teste, mas fazendo rede em suíte unitária.
  listWebhookEvents: vi.fn(),
  listOfferMappings: vi.fn(),
  getLicensingSettings: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { LicensesPage } = await import('./LicensesPage');

const CATALOGO: LicCatalogResponse = {
  signingConfigured: true,
  products: [
    {
      id: 'prod-1',
      slug: 'warroom',
      name: 'War Room',
      keyPrefix: 'WR',
      editions: [
        {
          id: 'ed-1',
          slug: 'closed',
          name: 'Sem código-fonte',
          billingModel: 'PERPETUAL',
          maxMachines: 2,
          updatesMonths: 12,
          licenseCount: 3,
        },
      ],
    },
  ],
};

const LICENCA: LicenseView = {
  id: 'lic-1',
  status: 'ACTIVE',
  customerEmail: 'comprador@exemplo.com',
  customerName: 'Comprador',
  editionSlug: 'closed',
  editionName: 'Sem código-fonte',
  productSlug: 'warroom',
  issuedAt: '2026-07-29T12:00:00Z',
  updatesUntil: '2027-07-29T12:00:00Z',
  expiresAt: null,
  revokedAt: null,
  revokedReason: null,
  activeMachines: 1,
  maxMachines: 2,
};

const MAQUINA = {
  id: 'act-1',
  fingerprint: 'fp-abcdef0123456789',
  hostname: 'desktop',
  appVersion: '1.0.0',
  activatedAt: '2026-07-29T12:00:00Z',
  lastSeenAt: '2026-07-29T13:00:00Z',
  deactivatedAt: null as string | null,
};

function montar() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/t/acme/licencas']}>
        <Routes>
          <Route path="/t/:tenant/licencas" element={<LicensesPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('SPEC-036: tela de Licenças', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getLicensingCatalog.mockResolvedValue(CATALOGO);
    apiMock.listLicenses.mockResolvedValue([LICENCA]);
    // O painel do PR-5 carrega junto: vazio é o estado neutro para os testes
    // desta página, que são sobre licenças.
    apiMock.listWebhookEvents.mockResolvedValue([]);
    apiMock.listOfferMappings.mockResolvedValue([]);
    apiMock.getLicensingSettings.mockResolvedValue({
      webhookSecretSet: true,
      pastDueToleranceDays: 15,
    });
    apiMock.listLicenseEvents.mockResolvedValue([]);
    apiMock.getLicenseDetail.mockResolvedValue({
      ...LICENCA,
      swapCount: 0,
      swapWindowDays: 30,
      activations: [MAQUINA],
    });
  });

  it('lista as licenças do workspace', async () => {
    montar();
    expect(await screen.findByText('Comprador')).toBeInTheDocument();
    expect(screen.getByText(/1 de 2 máquinas/)).toBeInTheDocument();
  });

  describe('a chave em claro', () => {
    it('aparece depois de emitir, com o aviso de que não volta', async () => {
      // A regra que organiza a tela: ela existe uma vez e some. Sem o aviso, o
      // admin fecha a página achando que consulta depois.
      apiMock.issueLicense.mockResolvedValue({
        ...LICENCA,
        key: 'WR-AB23-CD45-EF67-GH89',
      });
      montar();

      await userEvent.type(
        await screen.findByLabelText(/E-mail do comprador/),
        'novo@exemplo.com',
      );
      await userEvent.click(screen.getByRole('button', { name: /Emitir/ }));

      expect(await screen.findByText('WR-AB23-CD45-EF67-GH89')).toBeInTheDocument();
      expect(screen.getByText(/não será exibida de novo/i)).toBeInTheDocument();
    });

    it('some quando o admin confirma que copiou', async () => {
      apiMock.issueLicense.mockResolvedValue({
        ...LICENCA,
        key: 'WR-AB23-CD45-EF67-GH89',
      });
      montar();

      await userEvent.type(
        await screen.findByLabelText(/E-mail do comprador/),
        'novo@exemplo.com',
      );
      await userEvent.click(screen.getByRole('button', { name: /Emitir/ }));
      await screen.findByText('WR-AB23-CD45-EF67-GH89');

      await userEvent.click(screen.getByRole('button', { name: /Já copiei/ }));
      expect(screen.queryByText('WR-AB23-CD45-EF67-GH89')).not.toBeInTheDocument();
    });

    it('NÃO aparece na lista de licenças', async () => {
      // O servidor não devolve a chave em leitura nenhuma; este teste afirma
      // que a tela também não a guarda para reexibir.
      montar();
      await screen.findByText('Comprador');
      expect(screen.queryByText(/WR-[A-Z0-9]{4}-/)).not.toBeInTheDocument();
    });
  });

  describe('assinatura não configurada', () => {
    it('avisa que as chaves emitidas não vão ativar', async () => {
      // O aviso mais importante da tela: sem a chave privada, emitir funciona e
      // a ativação devolve 503 — quem descobre é o comprador, ao abrir o
      // produto.
      apiMock.getLicensingCatalog.mockResolvedValue({
        ...CATALOGO,
        signingConfigured: false,
      });
      montar();

      const aviso = await screen.findByRole('alert');
      expect(aviso).toHaveTextContent(/não vão ativar/i);
      expect(aviso).toHaveTextContent(/LICENSING_SIGNING_KEY/);
    });

    it('não aparece quando está configurada', async () => {
      montar();
      await screen.findByText('Comprador');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('revogar', () => {
    it('só aparece em licença ativa', async () => {
      apiMock.listLicenses.mockResolvedValue([
        { ...LICENCA, status: 'REVOKED', revokedAt: '2026-07-29T13:00:00Z', revokedReason: 'reembolso' },
      ]);
      montar();

      await screen.findByText('Comprador');
      expect(screen.queryByRole('button', { name: 'Revogar' })).not.toBeInTheDocument();
      expect(screen.getByText(/reembolso/)).toBeInTheDocument();
    });

    it('cancelar o prompt não chama a API', async () => {
      // `null` do prompt = cancelou. Revogar por engano é irreversível: a
      // licença não volta a ACTIVE.
      vi.spyOn(window, 'prompt').mockReturnValue(null);
      montar();

      await screen.findByText('Comprador');
      await userEvent.click(screen.getByRole('button', { name: 'Revogar' }));

      expect(apiMock.revokeLicense).not.toHaveBeenCalled();
    });

    it('envia o motivo digitado', async () => {
      vi.spyOn(window, 'prompt').mockReturnValue('chargeback');
      apiMock.revokeLicense.mockResolvedValue({ ...LICENCA, status: 'REVOKED' });
      montar();

      await screen.findByText('Comprador');
      await userEvent.click(screen.getByRole('button', { name: 'Revogar' }));

      await waitFor(() =>
        expect(apiMock.revokeLicense).toHaveBeenCalledWith('lic-1', 'chargeback'),
      );
    });
  });

  describe('busca', () => {
    it('texto com @ vira busca por e-mail', async () => {
      montar();
      await screen.findByText('Comprador');

      await userEvent.type(screen.getByLabelText(/Buscar/), 'ana@exemplo.com');
      await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

      await waitFor(() =>
        expect(apiMock.listLicenses).toHaveBeenLastCalledWith({ email: 'ana@exemplo.com' }),
      );
    });

    it('texto sem @ vira busca por chave', async () => {
      montar();
      await screen.findByText('Comprador');

      await userEvent.type(screen.getByLabelText(/Buscar/), 'WR-AB23-CD45-EF67-GH89');
      await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

      await waitFor(() =>
        expect(apiMock.listLicenses).toHaveBeenLastCalledWith({
          key: 'WR-AB23-CD45-EF67-GH89',
        }),
      );
    });
  });

  describe('gaveta: máquinas e trilha (SPEC-037)', () => {
    it('abre sob demanda e traduz os eventos', async () => {
      apiMock.listLicenseEvents.mockResolvedValue([
        { id: 'e1', type: 'issued', payload: null, createdAt: '2026-07-29T12:00:00Z' },
        { id: 'e2', type: 'activated', payload: null, createdAt: '2026-07-29T12:05:00Z' },
      ]);
      montar();

      await screen.findByText('Comprador');
      await userEvent.click(screen.getByRole('button', { name: /Máquinas e trilha/ }));

      expect(await screen.findByText(/Licença emitida/)).toBeInTheDocument();
      expect(screen.getByText(/Máquina ativada/)).toBeInTheDocument();
    });

    it('lista as máquinas, com a desativada riscada e datada', async () => {
      // A diferença que o suporte precisa: "esta máquina existiu e saiu em tal
      // data" é o que uma lista só das vivas não responde.
      apiMock.getLicenseDetail.mockResolvedValue({
        ...LICENCA,
        swapCount: 1,
        swapWindowDays: 30,
        activations: [
          { ...MAQUINA, hostname: 'desktop' },
          {
            ...MAQUINA,
            id: 'act-2',
            hostname: 'notebook-velho',
            deactivatedAt: '2026-07-28T10:00:00Z',
          },
        ],
      });
      montar();

      await screen.findByText('Comprador');
      await userEvent.click(screen.getByRole('button', { name: /Máquinas e trilha/ }));

      expect(await screen.findByText(/desktop/)).toBeInTheDocument();
      expect(screen.getByText(/notebook-velho/)).toBeInTheDocument();
      expect(screen.getByText(/desativada em/)).toBeInTheDocument();
    });

    it('só a máquina ativa tem botão de desativar', async () => {
      apiMock.getLicenseDetail.mockResolvedValue({
        ...LICENCA,
        swapCount: 0,
        swapWindowDays: 30,
        activations: [
          { ...MAQUINA, hostname: 'viva' },
          { ...MAQUINA, id: 'act-2', hostname: 'morta', deactivatedAt: '2026-07-28T10:00:00Z' },
        ],
      });
      montar();

      await screen.findByText('Comprador');
      await userEvent.click(screen.getByRole('button', { name: /Máquinas e trilha/ }));

      expect(await screen.findAllByRole('button', { name: 'Desativar' })).toHaveLength(1);
    });

    it('desativar chama a API e recarrega o detalhe', async () => {
      apiMock.getLicenseDetail.mockResolvedValue({
        ...LICENCA,
        swapCount: 0,
        swapWindowDays: 30,
        activations: [MAQUINA],
      });
      apiMock.deactivateActivation.mockResolvedValue({
        ...MAQUINA,
        deactivatedAt: '2026-07-29T14:00:00Z',
      });
      montar();

      await screen.findByText('Comprador');
      await userEvent.click(screen.getByRole('button', { name: /Máquinas e trilha/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Desativar' }));

      await waitFor(() =>
        expect(apiMock.deactivateActivation).toHaveBeenCalledWith('lic-1', 'act-1'),
      );
      // Duas chamadas: a de abrir e a de recarregar depois da ação.
      expect(apiMock.getLicenseDetail).toHaveBeenCalledTimes(2);
    });

    it('sem máquina nenhuma, diz isso em vez de lista em branco', async () => {
      apiMock.getLicenseDetail.mockResolvedValue({
        ...LICENCA,
        swapCount: 0,
        swapWindowDays: 30,
        activations: [],
      });
      montar();

      await screen.findByText('Comprador');
      await userEvent.click(screen.getByRole('button', { name: /Máquinas e trilha/ }));

      expect(await screen.findByText(/Nenhuma máquina ativou/)).toBeInTheDocument();
    });

    describe('o sinal de troca', () => {
      it('não aparece em uso normal', async () => {
        // 2 trocas em 30 dias é vida normal — formatar o PC, trocar de
        // notebook. Um número em toda licença treinaria o olho a ignorá-lo.
        apiMock.getLicenseDetail.mockResolvedValue({
          ...LICENCA,
          swapCount: 2,
          swapWindowDays: 30,
          activations: [MAQUINA],
        });
        montar();

        await screen.findByText('Comprador');
        await userEvent.click(screen.getByRole('button', { name: /Máquinas e trilha/ }));
        await screen.findByText(/Máquinas/);

        expect(screen.queryByText(/trocas em 30 dias/)).not.toBeInTheDocument();
      });

      it('aparece quando há o que sinalizar', async () => {
        apiMock.getLicenseDetail.mockResolvedValue({
          ...LICENCA,
          swapCount: 9,
          swapWindowDays: 30,
          activations: [MAQUINA],
        });
        montar();

        await screen.findByText('Comprador');
        await userEvent.click(screen.getByRole('button', { name: /Máquinas e trilha/ }));

        expect(await screen.findByText(/9 trocas em 30 dias/)).toBeInTheDocument();
      });
    });
  });

  describe('estados vazios', () => {
    it('sem produto, diz o que fazer em vez de mostrar formulário morto', async () => {
      // Ausência é informação (ADR-014).
      apiMock.getLicensingCatalog.mockResolvedValue({
        signingConfigured: true,
        products: [],
      });
      apiMock.listLicenses.mockResolvedValue([]);
      montar();

      expect(await screen.findByText(/Nenhum produto cadastrado ainda/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/E-mail do comprador/)).not.toBeInTheDocument();
    });

    it('sem licença, diz "nenhuma encontrada" em vez de lista em branco', async () => {
      apiMock.listLicenses.mockResolvedValue([]);
      montar();
      expect(await screen.findByText(/Nenhuma licença encontrada/)).toBeInTheDocument();
    });

    it('falha de carregamento aparece, não fica em branco', async () => {
      apiMock.getLicensingCatalog.mockRejectedValue(new Error('API 500: caiu'));
      montar();
      expect(await screen.findByText(/caiu/)).toBeInTheDocument();
    });
  });

  describe('produtos e edições', () => {
    it('vem recolhido — o caminho comum é emitir', async () => {
      // Cadastrar produto acontece uma vez na vida do workspace; aberto,
      // empurraria a emissão para baixo da dobra todo dia.
      montar();
      const botao = await screen.findByRole('button', { name: /Produtos e edições/ });
      expect(botao).toHaveAttribute('aria-expanded', 'false');
    });

    it('mostra quantas licenças saíram da edição — o que impede apagá-la', async () => {
      montar();
      await userEvent.click(
        await screen.findByRole('button', { name: /Produtos e edições/ }),
      );
      expect(screen.getByText(/3 licenças/)).toBeInTheDocument();
    });

    it('não oferece botão de remover produto nem edição', async () => {
      // O `ON DELETE RESTRICT` recusa apagar edição com licença vendida.
      // Oferecer o botão para depois recusá-lo é pior que não oferecer.
      montar();
      await userEvent.click(
        await screen.findByRole('button', { name: /Produtos e edições/ }),
      );
      expect(screen.queryByRole('button', { name: /Remover|Excluir|Apagar/ })).toBeNull();
    });
  });
});
