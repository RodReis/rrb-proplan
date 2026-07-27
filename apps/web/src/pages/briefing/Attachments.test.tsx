import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Attachments } from './Attachments';

/**
 * Anexos do briefing público (SPEC-031 §4).
 *
 * O que estes testes protegem:
 *
 *   - a recusa do SERVIDOR é o que aparece na tela (a checagem local é só
 *     conveniência — quem verifica a assinatura dos bytes é a API);
 *   - arquivo grande demais não vira requisição desperdiçada;
 *   - remover é otimista mas com rollback: falha devolve o item à lista;
 *   - link morto no meio avisa quem está respondendo, em vez de virar erro
 *     genérico de upload.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function setup(list: unknown[] = []) {
  const onLinkGone = vi.fn();
  const fetchMock = vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (!init?.method || init.method === 'GET') return Promise.resolve(json(list));
    return Promise.resolve(json({}));
  });
  render(<Attachments token="tok" onLinkGone={onLinkGone} />);
  return { onLinkGone, fetchMock, user: userEvent.setup() };
}

/** Um PNG de verdade em miniatura — o conteúdo não importa para a tela. */
function pngFile(name = 'logo.png', size = 1024) {
  const file = new File([new Uint8Array(size)], name, { type: 'image/png' });
  return file;
}

const input = () => screen.getByLabelText(/logo, referências/i, { selector: 'input' });

afterEach(() => vi.restoreAllMocks());

describe('Attachments (SPEC-031 §4)', () => {
  it('mostra os limites do ADR-025 em linguagem de cliente', () => {
    setup();
    expect(screen.getByText(/até 10 MB por arquivo, 5 arquivos/i)).toBeInTheDocument();
  });

  it('lista os anexos já enviados', async () => {
    setup([{ id: 'f1', name: 'logo.png', size: 2048, mime: 'image/png' }]);
    expect(await screen.findByText('logo.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
  });

  it('envia o arquivo escolhido e o acrescenta à lista', async () => {
    const onLinkGone = vi.fn();
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation((_i, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          json({ id: 'f9', name: 'logo.png', size: 1024, mime: 'image/png' }),
        );
      }
      return Promise.resolve(json([]));
    });
    render(<Attachments token="tok" onLinkGone={onLinkGone} />);
    const user = userEvent.setup();

    await user.upload(input(), pngFile());

    expect(await screen.findByText('logo.png')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(post).toBeDefined();
    // Multipart: o body é FormData, e o browser gera o boundary. Setar
    // Content-Type à mão quebraria o parse no servidor.
    expect((post![1] as RequestInit).body).toBeInstanceOf(FormData);
    expect((post![1] as RequestInit).headers).toBeUndefined();
  });

  it('arquivo acima de 10 MB nem chega a virar requisição', async () => {
    const { fetchMock, user } = setup();

    await user.upload(input(), pngFile('enorme.png', 11 * 1024 * 1024));

    expect(await screen.findByRole('alert')).toHaveTextContent('acima de 10 MB');
    expect(
      fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false);
  });

  it('recusa do servidor aparece com a MENSAGEM do servidor', async () => {
    // O caso que motiva a verificação por assinatura: extensão .png, conteúdo
    // que não é PNG. A tela não tem como saber — quem sabe é a API.
    const onLinkGone = vi.fn();
    vi.spyOn(global, 'fetch').mockImplementation((_i, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          json(
            { message: 'tipo não aceito — envie PNG, JPEG, WebP ou PDF', reason: 'mime_not_allowed' },
            422,
          ),
        );
      }
      return Promise.resolve(json([]));
    });
    render(<Attachments token="tok" onLinkGone={onLinkGone} />);
    const user = userEvent.setup();

    await user.upload(input(), pngFile('disfarce.png'));

    expect(await screen.findByRole('alert')).toHaveTextContent('tipo não aceito');
  });

  it('link morto durante o upload avisa, em vez de erro genérico', async () => {
    const onLinkGone = vi.fn();
    vi.spyOn(global, 'fetch').mockImplementation((_i, init) => {
      if (init?.method === 'POST') return Promise.resolve(json({}, 410));
      return Promise.resolve(json([]));
    });
    render(<Attachments token="tok" onLinkGone={onLinkGone} />);
    const user = userEvent.setup();

    await user.upload(input(), pngFile());

    await waitFor(() => expect(onLinkGone).toHaveBeenCalled());
  });

  it('remover tira da lista e chama DELETE', async () => {
    const { fetchMock, user } = setup([
      { id: 'f1', name: 'logo.png', size: 2048, mime: 'image/png' },
    ]);
    await screen.findByText('logo.png');

    await user.click(screen.getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(screen.queryByText('logo.png')).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.some(
        (c) => (c[1] as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('falha ao remover devolve o arquivo à lista (rollback)', async () => {
    const onLinkGone = vi.fn();
    vi.spyOn(global, 'fetch').mockImplementation((_i, init) => {
      if (init?.method === 'DELETE') return Promise.resolve(json({}, 500));
      return Promise.resolve(json([{ id: 'f1', name: 'logo.png', size: 2048, mime: 'image/png' }]));
    });
    render(<Attachments token="tok" onLinkGone={onLinkGone} />);
    const user = userEvent.setup();
    await screen.findByText('logo.png');

    await user.click(screen.getByRole('button', { name: 'Remover' }));

    // Volta para a lista: sumir para sempre um arquivo que ainda está no
    // servidor faria a pessoa reenviar e estourar a cota sem entender por quê.
    expect(await screen.findByText('logo.png')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('não foi possível remover');
  });

  it('com 5 arquivos, o seletor desabilita e a tela explica', async () => {
    setup(
      Array.from({ length: 5 }, (_, i) => ({
        id: `f${i}`,
        name: `arquivo-${i}.png`,
        size: 1024,
        mime: 'image/png',
      })),
    );

    await screen.findByText('arquivo-0.png');
    expect(input()).toBeDisabled();
    expect(screen.getByText(/limite de 5 arquivos atingido/i)).toBeInTheDocument();
  });
});
