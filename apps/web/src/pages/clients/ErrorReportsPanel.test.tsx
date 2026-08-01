import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LicCatalogResponse,
  LicErrorGroupView,
  LicErrorReportDetail,
  LicErrorReportView,
} from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listLicErrorReports: vi.fn(),
  listLicErrorGroups: vi.fn(),
  getLicErrorReport: vi.fn(),
  setLicErrorReportStatus: vi.fn(),
  purgeLicErrorReports: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { ErrorReportsPanel } = await import('./ErrorReportsPanel');

const CATALOGO = {
  products: [
    { id: 'prod-1', name: 'War Room', slug: 'warroom', editions: [] },
    { id: 'prod-2', name: 'Outro', slug: 'outro', editions: [] },
  ],
} as unknown as LicCatalogResponse;

const relato = (
  id: string,
  message: string,
  status: LicErrorReportView['status'] = 'NEW',
): LicErrorReportView => ({
  id,
  message,
  appVersion: '1.0.2',
  os: 'win-x64',
  source: 'CRASH',
  status,
  occurredAt: '2026-08-01T10:00:00Z',
  receivedAt: '2026-08-01T10:05:00Z',
  licenseId: 'lic-1',
});

const DETALHE: LicErrorReportDetail = {
  ...relato('a', 'Erro ao abrir projeto'),
  stack: 'at abrirProjeto()\nat main()',
  sessionTail: { arquivos: ['segredo-do-cliente.ts'] },
  userNote: 'travou ao salvar',
  contactEmail: 'contato@exemplo.com',
  license: {
    id: 'lic-1',
    customerEmail: 'comprador@exemplo.com',
    customerName: 'Ana Silva',
    status: 'ACTIVE',
    edition: { slug: 'source', product: { id: 'prod-1', name: 'War Room' } },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listLicErrorReports.mockResolvedValue([]);
  apiMock.listLicErrorGroups.mockResolvedValue([] as LicErrorGroupView[]);
});

describe('SPEC-043: a aba de erros', () => {
  it('abre filtrando por novos — é o único estado que pede ação', async () => {
    // Abrir em "todos" enterraria o que ninguém olhou sob meses de histórico já
    // resolvido.
    render(<ErrorReportsPanel catalogo={CATALOGO} />);

    await waitFor(() =>
      expect(apiMock.listLicErrorReports).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'NEW' }),
      ),
    );
  });

  it('lista os relatos com versão, origem e data', async () => {
    apiMock.listLicErrorReports.mockResolvedValue([relato('a', 'Erro ao abrir projeto')]);

    render(<ErrorReportsPanel catalogo={CATALOGO} />);

    expect(await screen.findByText('Erro ao abrir projeto')).toBeInTheDocument();
    expect(screen.getByText(/crash automático/)).toBeInTheDocument();
  });

  it('a LISTA não expõe e-mail nem sessão — só o detalhe', async () => {
    // `sessionTail` é o campo que o PI aceitou sob mitigação: contém nomes de
    // arquivos do projeto do usuário. Carregá-lo em toda linha o exporia a cada
    // abertura da aba, para todo relato, sem ninguém ter pedido.
    apiMock.listLicErrorReports.mockResolvedValue([relato('a', 'Erro ao abrir projeto')]);

    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await screen.findByText('Erro ao abrir projeto');

    expect(screen.queryByText(/comprador@exemplo.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/segredo-do-cliente/)).not.toBeInTheDocument();
  });

  it('o detalhe mostra o e-mail do comprador correlacionado', async () => {
    // Critério de aceite: a tabela não tem coluna de e-mail — vem do JOIN.
    apiMock.listLicErrorReports.mockResolvedValue([relato('a', 'Erro ao abrir projeto')]);
    apiMock.getLicErrorReport.mockResolvedValue(DETALHE);

    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));

    expect(await screen.findByText(/comprador@exemplo.com/)).toBeInTheDocument();
  });

  it('o detalhe separa o e-mail do comprador do informado no relato', async () => {
    // São pessoas possivelmente diferentes; fundi-los faria o operador responder
    // ao endereço errado.
    apiMock.listLicErrorReports.mockResolvedValue([relato('a', 'Erro ao abrir projeto')]);
    apiMock.getLicErrorReport.mockResolvedValue(DETALHE);

    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));

    expect(await screen.findByText(/E-mail informado no relato/)).toBeInTheDocument();
    expect(screen.getByText(/contato@exemplo.com/)).toBeInTheDocument();
  });

  it('o detalhe avisa que a sessão contém arquivos do usuário', async () => {
    // O aviso é a mitigação virando texto na tela: quem lê precisa saber que
    // está olhando conteúdo do projeto de outra pessoa.
    apiMock.listLicErrorReports.mockResolvedValue([relato('a', 'Erro ao abrir projeto')]);
    apiMock.getLicErrorReport.mockResolvedValue(DETALHE);

    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir' }));

    expect(
      await screen.findByText(/contém nomes de arquivos do projeto do usuário/),
    ).toBeInTheDocument();
  });

  it('o agrupamento aparece quando há mais de uma mensagem', async () => {
    apiMock.listLicErrorReports.mockResolvedValue([
      relato('a', 'Erro X'),
      relato('b', 'Erro Y'),
    ]);
    apiMock.listLicErrorGroups.mockResolvedValue([
      { message: 'Erro X', count: 12, lastReceivedAt: '2026-08-01T10:00:00Z' },
      { message: 'Erro Y', count: 1, lastReceivedAt: '2026-07-20T10:00:00Z' },
    ]);

    render(<ErrorReportsPanel catalogo={CATALOGO} />);

    expect(await screen.findByText(/12×/)).toBeInTheDocument();
  });

  it('triar avança o status e recarrega', async () => {
    apiMock.listLicErrorReports.mockResolvedValue([relato('a', 'Erro X', 'NEW')]);
    apiMock.setLicErrorReportStatus.mockResolvedValue({ id: 'a', status: 'TRIAGED' });

    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Analisar' }));

    expect(apiMock.setLicErrorReportStatus).toHaveBeenCalledWith('a', 'TRIAGED');
    await waitFor(() => expect(apiMock.listLicErrorReports).toHaveBeenCalledTimes(2));
  });

  it('filtrar por produto refaz a busca com o id', async () => {
    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await waitFor(() => expect(apiMock.listLicErrorReports).toHaveBeenCalled());

    await userEvent.selectOptions(screen.getByLabelText(/Produto/), 'prod-1');

    await waitFor(() =>
      expect(apiMock.listLicErrorReports).toHaveBeenLastCalledWith(
        expect.objectContaining({ productId: 'prod-1' }),
      ),
    );
  });

  it('o purge relata quantos saíram', async () => {
    apiMock.purgeLicErrorReports.mockResolvedValue({ removed: 3 });

    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Apagar com mais de 90 dias/ }),
    );

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringContaining('3 relato(s)'),
      ),
    );
  });

  it('purge sem nada a apagar não mente dizendo que apagou', async () => {
    // "Apagados 0 relatos" e "nenhum passou dos 90 dias" são fatos diferentes
    // para quem precisa provar que a retenção está sendo cumprida.
    apiMock.purgeLicErrorReports.mockResolvedValue({ removed: 0 });

    render(<ErrorReportsPanel catalogo={CATALOGO} />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Apagar com mais de 90 dias/ }),
    );

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringContaining('Nenhum relato passou'),
      ),
    );
  });

  it('sem relato novo, a tela diz o que isso significa', async () => {
    render(<ErrorReportsPanel catalogo={CATALOGO} />);

    expect(
      await screen.findByText(/Nenhum relato novo — nada quebrou, ou nada foi enviado/),
    ).toBeInTheDocument();
  });
});
