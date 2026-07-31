import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcePendingItem } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listSourcePending: vi.fn(),
  setLicenseGithubUsername: vi.fn(),
  reinviteSource: vi.fn(),
  removeSourceAccess: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { SourceAccessPanel } = await import('./SourceAccessPanel');

/**
 * A tela do acesso ao source (SPEC-039 PR-5).
 *
 * O que se testa aqui não é layout — é **o que a tela afirma e o que ela oferece**.
 * Os dois erram em silêncio: um botão que não faz nada ensina a ignorar erro, e um
 * texto que promete "código recuperado" mente para o operador (§Objetivo da spec).
 */
function pendencia(over: Partial<SourcePendingItem> = {}): SourcePendingItem {
  return {
    licenseId: 'lic-1',
    customerEmail: 'comprador@exemplo.com',
    customerName: 'Mario',
    editionName: 'Completa com código-fonte',
    sourceAccess: 'PENDING',
    githubUsername: null,
    sourceInviteAt: '2026-07-20T12:00:00.000Z',
    sourceAccessError: null,
    reason: 'awaiting_username',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listSourcePending.mockResolvedValue([]);
});

describe('lista de pendências', () => {
  it('vazia diz que todo comprador foi convidado', async () => {
    render(<SourceAccessPanel />);

    expect(
      await screen.findByText(/todo comprador com direito ao código-fonte já foi convidado/i),
    ).toBeInTheDocument();
  });

  it('mostra o comprador, a edição e o motivo', async () => {
    apiMock.listSourcePending.mockResolvedValue([pendencia()]);

    render(<SourceAccessPanel />);

    expect(await screen.findByText('Mario')).toBeInTheDocument();
    expect(screen.getByText('Completa com código-fonte')).toBeInTheDocument();
    expect(screen.getByText('Aguardando o comprador')).toBeInTheDocument();
  });

  it('exibe o erro do GitHub — é o que diz o que consertar', async () => {
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'failed', sourceAccessError: 'token inválido ou expirado' }),
    ]);

    render(<SourceAccessPanel />);

    expect(await screen.findByText('token inválido ou expirado')).toBeInTheDocument();
  });

  it('o contador conta só o que pede ação nossa', async () => {
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'failed' }),
      pendencia({ licenseId: 'l2', reason: 'invited_not_accepted', githubUsername: 'bob' }),
    ]);

    render(<SourceAccessPanel />);

    // `invited_not_accepted` depende do comprador clicar: contá-lo faria o
    // contador nunca zerar.
    expect(await screen.findByText('1 pendência')).toBeInTheDocument();
  });
});

describe('gravar o username', () => {
  it('salva e avisa que o convite sai na próxima rodada', async () => {
    const user = userEvent.setup();
    apiMock.listSourcePending.mockResolvedValue([pendencia()]);
    apiMock.setLicenseGithubUsername.mockResolvedValue({
      username: 'RodReis',
      previousInviteCanceled: false,
    });

    render(<SourceAccessPanel />);
    await user.type(await screen.findByLabelText(/username do github de/i), 'rodreis');
    await user.click(screen.getByRole('button', { name: /salvar username/i }));

    await waitFor(() =>
      expect(apiMock.setLicenseGithubUsername).toHaveBeenCalledWith('lic-1', 'rodreis'),
    );
    expect(toastMock.success).toHaveBeenCalledWith(expect.stringMatching(/RodReis/));
  });

  it('troca com convite anterior AVISA que alguém perdeu acesso', async () => {
    const user = userEvent.setup();
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'invited_not_accepted', sourceAccess: 'INVITED', githubUsername: 'errado' }),
    ]);
    apiMock.setLicenseGithubUsername.mockResolvedValue({
      username: 'RodReis',
      previousInviteCanceled: true,
    });

    render(<SourceAccessPanel />);
    const campo = await screen.findByLabelText(/username do github de/i);
    await user.clear(campo);
    await user.type(campo, 'rodreis');
    await user.click(screen.getByRole('button', { name: /salvar username/i }));

    // "Gravei" e "gravei e cancelei o convite errado" são desfechos diferentes: o
    // segundo significa que alguém perdeu acesso agora, e o operador precisa saber.
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/acesso anterior foi removido/),
      ),
    );
  });

  it('erro do servidor vira toast, não tela quebrada', async () => {
    const user = userEvent.setup();
    apiMock.listSourcePending.mockResolvedValue([pendencia()]);
    apiMock.setLicenseGithubUsername.mockRejectedValue(
      new Error('O usuário "zzz" não existe no GitHub'),
    );

    render(<SourceAccessPanel />);
    await user.type(await screen.findByLabelText(/username do github de/i), 'zzz');
    await user.click(screen.getByRole('button', { name: /salvar username/i }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/não existe no GitHub/)),
    );
  });
});

describe('botões que só aparecem quando fazem algo', () => {
  it('reemitir aparece em `failed` com username', async () => {
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'failed', githubUsername: 'rod', sourceAccess: 'FAILED' }),
    ]);

    render(<SourceAccessPanel />);

    expect(await screen.findByRole('button', { name: /reemitir convite/i })).toBeInTheDocument();
  });

  it('reemitir NÃO aparece sem username', async () => {
    apiMock.listSourcePending.mockResolvedValue([pendencia()]);

    render(<SourceAccessPanel />);
    await screen.findByText('Mario');

    // O servidor recusaria com 422 — um botão que sempre falha ensina a ignorar
    // erro.
    expect(screen.queryByRole('button', { name: /reemitir convite/i })).not.toBeInTheDocument();
  });

  it('remover acesso NÃO aparece sem convite emitido', async () => {
    apiMock.listSourcePending.mockResolvedValue([pendencia({ sourceAccess: 'PENDING' })]);

    render(<SourceAccessPanel />);
    await screen.findByText('Mario');

    // Oferecer isto sugeriria que existe acesso, e quem clicasse sairia com a
    // impressão de ter revogado algo.
    expect(screen.queryByRole('button', { name: /remover acesso/i })).not.toBeInTheDocument();
  });

  it('reemitir mostra o resumo da RODADA, não "convite reemitido"', async () => {
    const user = userEvent.setup();
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'failed', githubUsername: 'rod', sourceAccess: 'FAILED' }),
    ]);
    apiMock.reinviteSource.mockResolvedValue({
      convidados: 2,
      aceitos: 0,
      falhas: 1,
      aguardandoUsername: 0,
    });

    render(<SourceAccessPanel />);
    await user.click(await screen.findByRole('button', { name: /reemitir convite/i }));

    // Reemitir dispara a reconciliação do tenant inteiro. Prometer "convite
    // reemitido" esconderia que outras licenças também foram tocadas.
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/2 convidado.*1 falha/),
      ),
    );
  });
});

describe('remover acesso', () => {
  it('colaborador removido NÃO promete recuperação do código', async () => {
    const user = userEvent.setup();
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'invited_not_accepted', sourceAccess: 'ACTIVE', githubUsername: 'rod' }),
    ]);
    apiMock.removeSourceAccess.mockResolvedValue({ outcome: 'collaborator_removed' });

    render(<SourceAccessPanel />);
    await user.click(await screen.findByRole('button', { name: /remover acesso/i }));

    // **A regra do §Objetivo**: o que já foi clonado continua com ele, e o
    // mecanismo é contratual. Dizer só "acesso revogado" seria lido como "o código
    // voltou".
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/já foi clonado continua/),
      ),
    );
  });

  it('falha na remoção usa toast de ERRO e diz que o acesso continua', async () => {
    const user = userEvent.setup();
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'invited_not_accepted', sourceAccess: 'INVITED', githubUsername: 'rod' }),
    ]);
    apiMock.removeSourceAccess.mockResolvedValue({ outcome: 'failed' });

    render(<SourceAccessPanel />);
    await user.click(await screen.findByRole('button', { name: /remover acesso/i }));

    // Sucesso HTTP com fracasso real: a resposta chegou 200, e o acesso continua de
    // pé. Um toast verde aqui seria o fechamento frágil.
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/CONTINUA de pé/)),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

