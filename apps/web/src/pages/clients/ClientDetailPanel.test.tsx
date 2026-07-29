import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingStatus, Client, ClientDetail } from '../../lib/api';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiMock = vi.hoisted(() => ({
  getClient: vi.fn(),
  createClientProject: vi.fn(),
  getBriefingLink: vi.fn(),
  createBriefingLink: vi.fn(),
  revokeBriefingLink: vi.fn(),
  getBriefingStatus: vi.fn(),
  getBriefingVersion: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { ClientDetailPanel } = await import('./ClientDetailPanel');

const client: Client = {
  id: 'c1',
  name: 'Rafaela M M Barros',
  cpf: null,
  company: 'EPG Trindade',
  cnpj: null,
  email: 'rafaela@epg.com.br',
  phone: null,
  whatsapp: null,
  zipCode: null,
  street: null,
  district: null,
  city: null,
  state: null,
  notes: null,
  createdAt: '2026-07-26T10:00:00Z',
};

function detail(projects: ClientDetail['projects'] = []): ClientDetail {
  return { ...client, projects };
}

function project(over: Partial<ClientDetail['projects'][number]> = {}) {
  return {
    id: 'p1',
    clientId: 'c1',
    title: 'Site institucional',
    description: 'landing + blog',
    state: 'DRAFT' as const,
    createdAt: '2026-07-26T12:00:00Z',
    updatedAt: '2026-07-26T12:00:00Z',
    ...over,
  };
}

function briefingStatus(over: Partial<BriefingStatus> = {}): BriefingStatus {
  return {
    state: 'not_started',
    completedSteps: null,
    totalSteps: 9,
    receivedAt: null,
    versions: [],
    ...over,
  };
}

/**
 * Nenhum painel de PROJETO aberto por cima da gaveta.
 *
 * A gaveta do cliente é ela mesma `role="dialog"`, então `queryByRole('dialog')`
 * sempre a encontra — o que se quer afirmar é que nada abriu **sobre** ela.
 */
function semPainelDeProjeto(): boolean {
  const painéis = screen
    .queryAllByRole('dialog')
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((nome) => !nome.startsWith('Cliente '));
  return painéis.length === 0 && screen.queryByRole('heading', { name: 'Estimativa' }) === null;
}

function renderPanel(
  canWrite = true,
  drill: { openProjectId?: string | null; openPanel?: string | null } = {},
) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <ClientDetailPanel
      client={client}
      canWrite={canWrite}
      onClose={onClose}
      onChanged={onChanged}
      openProjectId={drill.openProjectId}
      openPanel={drill.openPanel}
    />,
  );
  return { onChanged, onClose };
}

describe('ClientDetailPanel', () => {
  beforeEach(() => {
    // O token lembrado é por aba: sem limpar, um teste enxerga o link do outro.
    sessionStorage.clear();
    Object.values(apiMock).forEach((fn) => fn.mockReset());
    apiMock.getClient.mockResolvedValue(detail());
    apiMock.getBriefingLink.mockResolvedValue({ active: false });
    apiMock.createBriefingLink.mockResolvedValue({
      id: 'l1',
      token: 'tok-secreto-256',
      expiresAt: null,
    });
    apiMock.revokeBriefingLink.mockResolvedValue({ revoked: 1 });
    apiMock.getBriefingStatus.mockResolvedValue(briefingStatus());
  });

  it('lista os projetos do cliente com o estado de cada um', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site institucional',
          description: 'landing + blog',
          state: 'DRAFT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    renderPanel();

    expect(await screen.findByText('Site institucional')).toBeInTheDocument();
    expect(screen.getByText('landing + blog')).toBeInTheDocument();
    expect(screen.getAllByText('Rascunho').length).toBeGreaterThan(0);
    expect(screen.getByText(/criado em 26\/07\/2026/i)).toBeInTheDocument();
  });

  it('cliente sem projeto explica que criar é o que alimenta o funil', async () => {
    renderPanel();
    expect(
      await screen.findByText(/o primeiro projeto cria o card do funil/i),
    ).toBeInTheDocument();
  });

  // ESTE é o teste que faltava e deixou o bug passar: nada afirmava que a UI
  // consegue CRIAR um projeto, então o funil ficava vazio para sempre.
  it('cria projeto pela UI e avisa o pai para recarregar o funil', async () => {
    apiMock.createClientProject.mockResolvedValue({
      id: 'p-novo',
      clientId: 'c1',
      title: 'Loja virtual',
      description: null,
      state: 'DRAFT',
      createdAt: '2026-07-26T13:00:00Z',
      updatedAt: '2026-07-26T13:00:00Z',
    });
    const { onChanged } = renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /novo projeto/i }),
    );
    await userEvent.type(screen.getByLabelText(/título/i), 'Loja virtual');
    await userEvent.click(screen.getByRole('button', { name: /criar projeto/i }));

    await waitFor(() =>
      expect(apiMock.createClientProject).toHaveBeenCalledWith('c1', {
        title: 'Loja virtual',
        description: null,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('título vazio não dispara request', async () => {
    renderPanel();
    await userEvent.click(
      await screen.findByRole('button', { name: /novo projeto/i }),
    );

    expect(screen.getByRole('button', { name: /criar projeto/i })).toBeDisabled();
    expect(apiMock.createClientProject).not.toHaveBeenCalled();
  });

  it('após criar, abre o link de briefing e o token aparece uma vez', async () => {
    apiMock.createClientProject.mockResolvedValue({
      id: 'p-novo',
      clientId: 'c1',
      title: 'Loja virtual',
      description: null,
      state: 'DRAFT',
      createdAt: '2026-07-26T13:00:00Z',
      updatedAt: '2026-07-26T13:00:00Z',
    });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /novo projeto/i }),
    );
    await userEvent.type(screen.getByLabelText(/título/i), 'Loja virtual');
    await userEvent.click(screen.getByRole('button', { name: /criar projeto/i }));

    expect(
      await screen.findByRole('dialog', { name: /link de briefing/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /gerar link/i }));

    // O token completo só existe na resposta do POST — a UI o mostra para copiar.
    const campo = await screen.findByDisplayValue(/\/b\/tok-secreto-256$/);
    expect(campo).toHaveAttribute('readonly');
    expect(screen.getByText(/guardado só nesta aba/i)).toBeInTheDocument();
  });

  /**
   * O defeito relatado: gerar o link, fechar a janela e não ter como copiá-lo de
   * novo. O servidor guarda só o hash, então quem lembra é a aba.
   */
  it('reabrir a gaveta oferece o link vigente para copiar de novo', async () => {
    apiMock.getClient.mockResolvedValue(detail([project({ state: 'LINK_SENT' })]));
    apiMock.getBriefingLink.mockResolvedValue({ active: false });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /^gerar link$/i }),
    );
    expect(
      await screen.findByDisplayValue(/\/b\/tok-secreto-256$/),
    ).toBeInTheDocument();

    // A partir daqui o servidor reporta o link como ativo, sem devolver o token.
    apiMock.getBriefingLink.mockResolvedValue({
      active: true,
      id: 'l1',
      expiresAt: null,
      createdAt: '2026-07-27T12:00:00Z',
      status: 'valid',
    });

    await userEvent.click(screen.getByRole('button', { name: /^fechar$/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );

    expect(
      await screen.findByDisplayValue(/\/b\/tok-secreto-256$/),
    ).toBeInTheDocument();
    expect(screen.getByText(/link vigente deste projeto/i)).toBeInTheDocument();
  });

  /**
   * O token de sessão sobrevive à expiração feita no servidor. Oferecer para
   * cópia uma URL morta é pior que não oferecer nenhuma: o operador manda para o
   * cliente e só descobre pela reclamação.
   */
  it('link expirado não oferece cópia e o botão diz "Gerar novo link"', async () => {
    // Token lembrado de uma sessão anterior — sem passar por gerar agora.
    sessionStorage.setItem(
      'proplan:briefingTokens',
      JSON.stringify({ p1: 'tok-secreto-256' }),
    );
    apiMock.getClient.mockResolvedValue(detail([project({ state: 'LINK_SENT' })]));
    apiMock.getBriefingLink.mockResolvedValue({
      active: true,
      id: 'l1',
      expiresAt: '2026-07-20T23:59:59.000Z',
      createdAt: '2026-07-10T12:00:00Z',
      status: 'expired',
    });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );

    expect(await screen.findByText(/link expirado em/i)).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue(/\/b\/tok-secreto-256$/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /gerar novo link/i }),
    ).toBeInTheDocument();
  });

  // Fechar deixou de ser destrutivo — o token fica na sessão.
  it('fecha por backdrop mesmo com o link visível', async () => {
    apiMock.getClient.mockResolvedValue(detail([project()]));
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /^gerar link$/i }),
    );
    expect(
      await screen.findByDisplayValue(/\/b\/tok-secreto-256$/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('briefing-link-backdrop'));

    expect(
      screen.queryByRole('dialog', { name: /link de briefing/i }),
    ).not.toBeInTheDocument();
  });

  it('link válido oferece Revogar e o botão diz Regenerar, não Gerar', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site',
          description: null,
          state: 'LINK_SENT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    apiMock.getBriefingLink.mockResolvedValue({
      active: true,
      id: 'l1',
      expiresAt: '2026-08-01T23:59:59.000Z',
      createdAt: '2026-07-26T12:00:00Z',
      status: 'valid',
    });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );

    expect(await screen.findByText('link ativo')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /regenerar link/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^gerar link$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revogar/i })).toBeInTheDocument();
    expect(screen.getByText('26/07/2026')).toBeInTheDocument();
    expect(screen.getByText('01/08/2026')).toBeInTheDocument();
  });

  it('regenerar pede confirmação — invalida o link que o cliente já recebeu', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site',
          description: null,
          state: 'LINK_SENT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    apiMock.getBriefingLink.mockResolvedValue({
      active: true,
      id: 'l1',
      expiresAt: null,
      createdAt: '2026-07-26T12:00:00Z',
      status: 'valid',
    });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /regenerar link/i }),
    );

    expect(await screen.findByText(/deixa de funcionar imediatamente/i)).toBeInTheDocument();
    expect(apiMock.createBriefingLink).not.toHaveBeenCalled();
  });

  it('viewer lê os projetos mas não vê criar nem gerar link', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site',
          description: null,
          state: 'DRAFT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    renderPanel(false);

    expect(await screen.findByText('Site')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /novo projeto/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /link de briefing/i }),
    ).not.toBeInTheDocument();
  });

  it('Esc fecha a gaveta', async () => {
    const { onClose } = renderPanel();
    await screen.findByText(/nenhum projeto ainda/i);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('falha ao carregar mostra aviso com "tentar de novo", não painel em branco', async () => {
    apiMock.getClient.mockRejectedValue(new Error('API 500: db down'));
    renderPanel();

    expect(
      await screen.findByText(/não foi possível carregar os projetos/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/db down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
  });

  /**
   * Estado do briefing na gaveta (SPEC-031 §6). O critério de aceite é literal:
   * *"não iniciado · em preenchimento com progresso · recebido em data"*.
   */
  describe('estado do briefing', () => {
    it('sem envio nem rascunho: não iniciado, e nada para abrir', async () => {
      apiMock.getClient.mockResolvedValue(detail([project()]));
      renderPanel();

      expect(await screen.findByText(/briefing não iniciado/i)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /ver briefing/i }),
      ).not.toBeInTheDocument();
    });

    it('em preenchimento mostra o progresso, não só "iniciado"', async () => {
      apiMock.getClient.mockResolvedValue(detail([project()]));
      apiMock.getBriefingStatus.mockResolvedValue(
        briefingStatus({ state: 'in_progress', completedSteps: 4 }),
      );
      renderPanel();

      expect(await screen.findByText(/em preenchimento · 4 de 9/i)).toBeInTheDocument();
    });

    it('recebido mostra a data e libera a leitura', async () => {
      apiMock.getClient.mockResolvedValue(detail([project()]));
      apiMock.getBriefingStatus.mockResolvedValue(
        briefingStatus({
          state: 'received',
          receivedAt: '2026-07-26T13:00:00Z',
          versions: [{ id: 'v1', version: 1, submittedAt: '2026-07-26T13:00:00Z' }],
        }),
      );
      renderPanel();

      expect(await screen.findByText(/recebido em 26\/07\/2026/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /ver briefing/i })).toBeInTheDocument();
    });

    /**
     * O critério de aceite da spec §6 é explícito: *"`viewer` consegue ler o
     * briefing"*. Ligar a leitura em `canWrite` seria o erro fácil aqui — o
     * botão de link ao lado dele é restrito, e copiar a condição passaria numa
     * revisão visual.
     */
    it('viewer abre o briefing, mesmo sem poder gerar link', async () => {
      apiMock.getClient.mockResolvedValue(detail([project()]));
      apiMock.getBriefingStatus.mockResolvedValue(
        briefingStatus({
          state: 'received',
          receivedAt: '2026-07-26T13:00:00Z',
          versions: [{ id: 'v1', version: 1, submittedAt: '2026-07-26T13:00:00Z' }],
        }),
      );
      renderPanel(false);

      expect(
        await screen.findByRole('button', { name: /ver briefing/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /link de briefing/i }),
      ).not.toBeInTheDocument();
    });

    it('estado do briefing indisponível não derruba a lista de projetos', async () => {
      apiMock.getClient.mockResolvedValue(detail([project()]));
      apiMock.getBriefingStatus.mockRejectedValue(new Error('API 500'));
      renderPanel();

      // O conteúdo principal é a lista; o estado do briefing é acessório.
      expect(await screen.findByText('Site institucional')).toBeInTheDocument();
      expect(screen.getByText(/briefing não iniciado/i)).toBeInTheDocument();
    });

    it('abre o briefing em leitura ao clicar', async () => {
      apiMock.getClient.mockResolvedValue(detail([project()]));
      apiMock.getBriefingStatus.mockResolvedValue(
        briefingStatus({
          state: 'received',
          receivedAt: '2026-07-26T13:00:00Z',
          versions: [{ id: 'v1', version: 1, submittedAt: '2026-07-26T13:00:00Z' }],
        }),
      );
      apiMock.getBriefingVersion.mockResolvedValue({
        id: 'v1',
        version: 1,
        submittedAt: '2026-07-26T13:00:00Z',
        clientProjectId: 'p1',
        answers: { '1': { company: 'EPG Trindade', segment: 'G' } },
        labels: { '1.segment': 'Comércio e varejo' },
        attachments: [],
      });
      renderPanel();

      await userEvent.click(
        await screen.findByRole('button', { name: /ver briefing/i }),
      );

      expect(await screen.findByText('EPG Trindade')).toBeInTheDocument();
      // O rótulo do servidor, nunca o código gravado.
      expect(screen.getByText('Comércio e varejo')).toBeInTheDocument();
      expect(screen.queryByText('G')).not.toBeInTheDocument();
    });
  });

  /**
   * Drill-down do dashboard (SPEC-035 §7.3): a URL diz qual projeto e qual
   * painel, e a gaveta abre já no lugar certo — em vez de deixar a pessoa
   * procurar dentro dela o item que ela acabou de clicar.
   */
  describe('abre o painel pedido na URL (SPEC-035 §7.3)', () => {
    beforeEach(() => {
      apiMock.getClient.mockResolvedValue(detail([project()]));
      apiMock.getBriefingStatus.mockResolvedValue(briefingStatus());
    });

    it('`painel=artefatos` abre os artefatos do projeto sem ninguém clicar', async () => {
      renderPanel(true, { openProjectId: 'p1', openPanel: 'artefatos' });

      expect(
        await screen.findByRole('dialog', { name: 'Artefatos de Site institucional' }),
      ).toBeInTheDocument();
    });

    it('`painel=contratos` abre os contratos', async () => {
      renderPanel(true, { openProjectId: 'p1', openPanel: 'contratos' });

      expect(
        await screen.findByRole('dialog', { name: 'Contratos de Site institucional' }),
      ).toBeInTheDocument();
    });

    it('`painel=estimativa` abre a estimativa', async () => {
      renderPanel(true, { openProjectId: 'p1', openPanel: 'estimativa' });

      expect(
        await screen.findByRole('heading', { name: 'Estimativa' }),
      ).toBeInTheDocument();
    });

    it('painel desconhecido é IGNORADO — a gaveta abre normal, sem link morto', async () => {
      // O §7.3 é sobre não ensinar ninguém a desconfiar dos links. Um valor que
      // a tela não conhece não pode derrubar nada nem abrir a coisa errada.
      renderPanel(true, { openProjectId: 'p1', openPanel: 'inventado' });

      expect(await screen.findByText('Site institucional')).toBeInTheDocument();
      // A gaveta do CLIENTE é ela mesma um `dialog` — o que não pode aparecer
      // é um painel de projeto por cima.
      expect(semPainelDeProjeto()).toBe(true);
    });

    it('projeto inexistente não abre nada — link velho para projeto apagado', async () => {
      renderPanel(true, { openProjectId: 'nao-existe', openPanel: 'artefatos' });

      expect(await screen.findByText('Site institucional')).toBeInTheDocument();
      // A gaveta do CLIENTE é ela mesma um `dialog` — o que não pode aparecer
      // é um painel de projeto por cima.
      expect(semPainelDeProjeto()).toBe(true);
    });

    it('sem os parâmetros nada abre — o comportamento antigo não muda', async () => {
      renderPanel();

      expect(await screen.findByText('Site institucional')).toBeInTheDocument();
      // A gaveta do CLIENTE é ela mesma um `dialog` — o que não pode aparecer
      // é um painel de projeto por cima.
      expect(semPainelDeProjeto()).toBe(true);
    });

    it('fechar o painel NÃO o reabre — a URL ainda pede, mas a trava segura', async () => {
      // Sem a trava do `abertoPara`, fechar veria o efeito reabrir no render
      // seguinte, porque o parâmetro continua na URL. A pessoa fecharia e o
      // painel voltaria — pior que não abrir.
      renderPanel(true, { openProjectId: 'p1', openPanel: 'artefatos' });

      const painel = await screen.findByRole('dialog', {
        name: 'Artefatos de Site institucional',
      });
      await userEvent.click(
        within(painel).getByRole('button', { name: 'Fechar' }),
      );

      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Artefatos de Site institucional' }),
        ).not.toBeInTheDocument(),
      );
    });
  });
});
