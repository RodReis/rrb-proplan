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

describe('BriefingLinkPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('token válido: confirma o link e avisa que o formulário vem depois', async () => {
    jsonOnce({ status: 'valid' });
    renderAt('tok-valido');

    expect(await screen.findByText('Link confirmado')).toBeInTheDocument();
    expect(screen.getByText(/formulário para você preencher/i)).toBeInTheDocument();
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
    const fetchMock = jsonOnce({ status: 'valid' });
    renderAt('tok%2Fcom-barra');
    await screen.findByText('Link confirmado');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/b/');
    // O token vem do path e é reescapado: sem isso, um `/` no valor quebraria a URL.
    expect(url).not.toMatch(/\/b\/[^?]*\/[^?]/);
  });

  it('não manda credenciais — rota pública, cookie de sessão só ampliaria a superfície', async () => {
    const fetchMock = jsonOnce({ status: 'valid' });
    renderAt('tok');
    await screen.findByText('Link confirmado');

    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.credentials).toBeUndefined();
  });
});
