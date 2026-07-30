import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourcePendingItem } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listSourcePending: vi.fn(),
  getSourceSettings: vi.fn(),
  setLicenseGithubUsername: vi.fn(),
  reinviteSource: vi.fn(),
  removeSourceAccess: vi.fn(),
  setSourcePat: vi.fn(),
  testSourceConnection: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { SourceOpsPanel } = await import('./SourceOpsPanel');

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
  apiMock.getSourceSettings.mockResolvedValue({ githubPatSet: true, sourceRepo: 'RodReis/wr' });
});

describe('lista de pendências', () => {
  it('vazia diz que todo comprador foi convidado', async () => {
    render(<SourceOpsPanel />);

    expect(
      await screen.findByText(/todo comprador com direito ao código-fonte já foi convidado/i),
    ).toBeInTheDocument();
  });

  it('mostra o comprador, a edição e o motivo', async () => {
    apiMock.listSourcePending.mockResolvedValue([pendencia()]);

    render(<SourceOpsPanel />);

    expect(await screen.findByText('Mario')).toBeInTheDocument();
    expect(screen.getByText('Completa com código-fonte')).toBeInTheDocument();
    expect(screen.getByText('Aguardando o comprador')).toBeInTheDocument();
  });

  it('exibe o erro do GitHub — é o que diz o que consertar', async () => {
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'failed', sourceAccessError: 'token inválido ou expirado' }),
    ]);

    render(<SourceOpsPanel />);

    expect(await screen.findByText('token inválido ou expirado')).toBeInTheDocument();
  });

  it('o contador conta só o que pede ação nossa', async () => {
    apiMock.listSourcePending.mockResolvedValue([
      pendencia({ reason: 'failed' }),
      pendencia({ licenseId: 'l2', reason: 'invited_not_accepted', githubUsername: 'bob' }),
    ]);

    render(<SourceOpsPanel />);

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

    render(<SourceOpsPanel />);
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

    render(<SourceOpsPanel />);
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

    render(<SourceOpsPanel />);
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

    render(<SourceOpsPanel />);

    expect(await screen.findByRole('button', { name: /reemitir convite/i })).toBeInTheDocument();
  });

  it('reemitir NÃO aparece sem username', async () => {
    apiMock.listSourcePending.mockResolvedValue([pendencia()]);

    render(<SourceOpsPanel />);
    await screen.findByText('Mario');

    // O servidor recusaria com 422 — um botão que sempre falha ensina a ignorar
    // erro.
    expect(screen.queryByRole('button', { name: /reemitir convite/i })).not.toBeInTheDocument();
  });

  it('remover acesso NÃO aparece sem convite emitido', async () => {
    apiMock.listSourcePending.mockResolvedValue([pendencia({ sourceAccess: 'PENDING' })]);

    render(<SourceOpsPanel />);
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

    render(<SourceOpsPanel />);
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

    render(<SourceOpsPanel />);
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

    render(<SourceOpsPanel />);
    await user.click(await screen.findByRole('button', { name: /remover acesso/i }));

    // Sucesso HTTP com fracasso real: a resposta chegou 200, e o acesso continua de
    // pé. Um toast verde aqui seria o fechamento frágil.
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/CONTINUA de pé/)),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe('PAT write-only e teste de conexão', () => {
  it('o campo é do tipo password e o valor nunca vem da API', async () => {
    render(<SourceOpsPanel />);

    const campo = await screen.findByLabelText(/pat do github/i);
    expect(campo).toHaveAttribute('type', 'password');
    // O `GET` devolve só `githubPatSet` — não há valor para preencher.
    expect(campo).toHaveValue('');
  });

  it('configurado não afirma que funciona — aponta o teste', async () => {
    render(<SourceOpsPanel />);

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

    render(<SourceOpsPanel />);
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

    render(<SourceOpsPanel />);
    await user.click(await screen.findByRole('button', { name: /testar conexão/i }));

    expect(await screen.findByText(/administra RodReis\/war-room/)).toBeInTheDocument();
  });

  it('testar fica desabilitado sem PAT configurado', async () => {
    apiMock.getSourceSettings.mockResolvedValue({ githubPatSet: false, sourceRepo: null });

    render(<SourceOpsPanel />);

    expect(await screen.findByRole('button', { name: /testar conexão/i })).toBeDisabled();
  });

  it('salvar PAT limpa o campo e manda testar', async () => {
    const user = userEvent.setup();
    apiMock.setSourcePat.mockResolvedValue({ githubPatSet: true, sourceRepo: 'RodReis/wr' });

    render(<SourceOpsPanel />);
    const campo = await screen.findByLabelText(/pat do github/i);
    await user.type(campo, 'github_pat_abc');
    await user.click(screen.getByRole('button', { name: /salvar pat/i }));

    await waitFor(() => expect(apiMock.setSourcePat).toHaveBeenCalledWith('github_pat_abc'));
    // Não deixa o segredo no DOM depois de salvo.
    expect(campo).toHaveValue('');
    expect(toastMock.success).toHaveBeenCalledWith(expect.stringMatching(/teste de conexão/));
  });
});
