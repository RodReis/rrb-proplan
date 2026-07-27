import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BriefingLinkPage } from './BriefingLinkPage';

/**
 * A página pública do link (FIX #136). O que se prova aqui é o que o **cliente do
 * prestador** vê — alguém sem conta, que recebeu o link por fora.
 */
function renderAt(token: string) {
  render(
    <MemoryRouter initialEntries={[`/b/${token}`]}>
      <Routes>
        <Route path="/b/:token" element={<BriefingLinkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function jsonOnce(body: unknown, status = 200) {
  return vi
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const CATALOG = { segments: [], states: [], services: {} };

/**
 * Link válido busca DUAS rotas: o estado e o catálogo da etapa 1. Roteia por
 * URL em vez de por ordem — a página pode reordenar as chamadas sem que o teste
 * passe a mentir.
 */
function routed(state: unknown, catalog: unknown = CATALOG, status = 200) {
  return vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const body = url.includes('/catalog') ? catalog : state;
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
}

describe('BriefingLinkPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('token válido: abre o formulário na etapa 1', async () => {
    routed({ status: 'valid', step: 1, answers: {} });
    renderAt('tok-valido');

    expect(await screen.findByText('Contexto do negócio')).toBeInTheDocument();
    expect(screen.getByText('Etapa 1 de 9')).toBeInTheDocument();
  });

  it('retoma na etapa em que parou, com o que já foi respondido', async () => {
    routed({
      status: 'valid',
      step: 4,
      answers: { '4': { kind: 'landing' } },
    });
    renderAt('tok');

    expect(await screen.findByText('Solução e funcionalidades')).toBeInTheDocument();
    expect(screen.getByText('Etapa 4 de 9')).toBeInTheDocument();
    expect(screen.getByLabelText(/tipo de solução/i)).toHaveValue('landing');
  });

  it('briefing já enviado não reabre o formulário nem devolve as respostas', async () => {
    routed({ status: 'submitted' });
    renderAt('tok');

    expect(await screen.findByText('Briefing recebido')).toBeInTheDocument();
    expect(screen.queryByText('Etapa 1 de 9')).not.toBeInTheDocument();
  });

  it('expirado pede um link novo a quem enviou', async () => {
    jsonOnce({ status: 'expired' });
    renderAt('tok');
    expect(await screen.findByText('Link expirado')).toBeInTheDocument();
  });

  it('revogado explica que foi cancelado por quem enviou', async () => {
    jsonOnce({ status: 'revoked' });
    renderAt('tok');
    expect(await screen.findByText('Link cancelado')).toBeInTheDocument();
  });

  it('inválido não acusa o visitante — sugere conferir a cópia', async () => {
    jsonOnce({ status: 'invalid' });
    renderAt('tok');
    expect(await screen.findByText('Link inválido')).toBeInTheDocument();
    expect(screen.getByText(/copiado por inteiro/i)).toBeInTheDocument();
  });

  it('404 do backend cai em inválido, não em erro técnico', async () => {
    jsonOnce({ status: 'invalid' }, 404);
    renderAt('tok');
    expect(await screen.findByText('Link inválido')).toBeInTheDocument();
  });

  // Não-diferencial: token inexistente e token de OUTRO tenant devolvem o mesmo
  // `invalid` no backend (SPEC-029). A tela não pode desfazer isso.
  it('inexistente e de outro tenant são indistinguíveis na tela', async () => {
    jsonOnce({ status: 'invalid' });
    renderAt('nao-existe');
    const primeira = (await screen.findByText('Link inválido')).textContent;

    vi.restoreAllMocks();
    jsonOnce({ status: 'invalid' });
    renderAt('de-outro-tenant');
    const textos = await screen.findAllByText('Link inválido');
    expect(textos[textos.length - 1].textContent).toBe(primeira);
  });

  it('rate limit (429) não vira "link inválido" — acusaria um link possivelmente bom', async () => {
    jsonOnce({ message: 'Too many requests' }, 429);
    renderAt('tok');

    expect(
      await screen.findByText(/não foi possível verificar agora/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Link inválido')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
  });

  it('rede fora mostra "tentar de novo", não tela branca', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    renderAt('tok');
    expect(
      await screen.findByText(/não foi possível verificar agora/i),
    ).toBeInTheDocument();
  });

  it('resposta sem status conhecido degrada para inválido', async () => {
    jsonOnce({});
    renderAt('tok');
    expect(await screen.findByText('Link inválido')).toBeInTheDocument();
  });

  it('chama a API no caminho público, com o token escapado', async () => {
    const fetchMock = routed({ status: 'valid', step: 1, answers: {} });
    renderAt('tok%2Fcom-barra');
    await screen.findByText('Contexto do negócio');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/b/');
    // O token vem do path e é reescapado: sem isso, um `/` no valor quebraria a URL.
    expect(url).not.toMatch(/\/b\/[^?/]*\/(?!catalog|cities|draft)/);
  });

  it('não manda credenciais — rota pública, cookie de sessão só ampliaria a superfície', async () => {
    const fetchMock = routed({ status: 'valid', step: 1, answers: {} });
    renderAt('tok');
    await screen.findByText('Contexto do negócio');

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.credentials).toBeUndefined();
    }
  });
});
