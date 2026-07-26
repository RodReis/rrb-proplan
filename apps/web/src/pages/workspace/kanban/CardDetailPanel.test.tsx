import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardCard, CardDetail } from '../../../lib/api';

// `api` é propriedade de um objeto (`api.cardDetail`), não named export — então
// o mock substitui o objeto preservando o resto do módulo. É o primeiro mock
// desse tipo no repo; o padrão do `ClientsPage.test` spreada named exports, que
// não alcançaria `api.*`.
const cardDetail = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, api: { ...actual.api, cardDetail } };
});

// Mermaid puxa a lib inteira no import; a gaveta não desenha diagrama nos testes.
vi.mock('../Mermaid', () => ({ Mermaid: () => null }));

const { CardDetailPanel } = await import('./CardDetailPanel');

const card: BoardCard = {
  number: 128,
  title: '[SPEC-030] Painel de detalhe do card',
  column: 'doing',
  priority: 'media',
  assignee: { login: 'RodReis', avatarUrl: 'a' },
  htmlUrl: 'https://github.com/RodReis/rrb-proplan/issues/128',
  createdAt: '2026-07-25T20:19:42Z',
  closedAt: null,
  closedOutside: false,
  parentNumber: null,
};

function detail(over: Partial<CardDetail> = {}): CardDetail {
  return {
    number: 128,
    title: '[SPEC-030] Painel de detalhe do card',
    state: 'open',
    htmlUrl: card.htmlUrl,
    body: '## O problema\n\nClicar num card abre um formulário.',
    author: { login: 'RodReis', avatarUrl: 'a' },
    assignees: [{ login: 'RodReis', avatarUrl: 'a' }],
    labels: [{ name: 'proplan:doing', color: '0e8a16' }],
    createdAt: '2026-07-25T20:19:42Z',
    updatedAt: '2026-07-26T10:00:00Z',
    closedAt: null,
    timeline: [
      {
        type: 'opened',
        actor: { login: 'RodReis', avatarUrl: 'a' },
        createdAt: '2026-07-25T20:19:42Z',
      },
    ],
    fetchedAt: '2026-07-26T21:00:00Z',
    ...over,
  };
}

function renderPanel(props: Partial<Parameters<typeof CardDetailPanel>[0]> = {}) {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  render(
    <CardDetailPanel
      card={card}
      projectId="p1"
      canEdit
      onClose={onClose}
      onEdit={onEdit}
      {...props}
    />,
  );
  return { onClose, onEdit };
}

describe('CardDetailPanel', () => {
  beforeEach(() => {
    cardDetail.mockReset();
    cardDetail.mockResolvedValue(detail());
  });

  it('lê o card ao abrir e renderiza o corpo da issue', async () => {
    renderPanel();
    expect(await screen.findByText('O problema')).toBeInTheDocument();
    expect(cardDetail).toHaveBeenCalledWith('p1', 128);
  });

  it('mostra "sem descrição" quando o corpo está vazio, não área em branco', async () => {
    cardDetail.mockResolvedValue(detail({ body: null }));
    renderPanel();
    expect(await screen.findByText('Sem descrição.')).toBeInTheDocument();
  });

  it('cabeçalho traz #N, estado, autor, responsáveis e as datas', async () => {
    renderPanel();
    expect(await screen.findByRole('link', { name: '#128' })).toBeInTheDocument();
    expect(screen.getByText('aberta')).toBeInTheDocument();
    expect(screen.getByText('proplan:doing')).toBeInTheDocument();
    expect(screen.getByText('aberta em')).toBeInTheDocument();
    expect(screen.getByText('atualizada em')).toBeInTheDocument();
  });

  it('trilha descreve o evento com ator e data', async () => {
    renderPanel();
    expect(await screen.findByText('RodReis abriu')).toBeInTheDocument();
  });

  it('trilha vazia diz que não há evento, em vez de seção muda', async () => {
    cardDetail.mockResolvedValue(detail({ timeline: [] }));
    renderPanel();
    expect(await screen.findByText('Sem eventos registrados.')).toBeInTheDocument();
  });

  it('trilha longa corta em 10 e "ver todos" expande em linha', async () => {
    cardDetail.mockResolvedValue(
      detail({
        timeline: Array.from({ length: 13 }, (_, i) => ({
          type: 'labeled' as const,
          actor: { login: `ator${i}`, avatarUrl: 'a' },
          createdAt: `2026-07-25T20:${String(i).padStart(2, '0')}:00Z`,
          label: { name: `l${i}`, color: '0e8a16' },
        })),
      }),
    );
    renderPanel();

    const verTodos = await screen.findByRole('button', {
      name: /ver todos \(3 anteriores\)/i,
    });
    // O mais antigo (ator0) está escondido; o mais recente (ator12) aparece.
    expect(screen.queryByText('ator0 adicionou')).not.toBeInTheDocument();
    expect(screen.getByText('ator12 adicionou')).toBeInTheDocument();

    await userEvent.click(verTodos);
    expect(screen.getByText('ator0 adicionou')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /ver todos/i }),
    ).not.toBeInTheDocument();
  });

  it('botão Editar chama o pai — o formulário continua sendo o EditCardPopover', async () => {
    const { onEdit } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('viewer (canEdit=false) lê o card mas não vê o botão Editar', async () => {
    renderPanel({ canEdit: false });
    expect(await screen.findByText('O problema')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('Esc fecha a gaveta (DESIGN.md §11)', async () => {
    const { onClose } = renderPanel();
    await screen.findByText('O problema');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('falha na leitura abre modo degradado com o cache do board e "tentar de novo"', async () => {
    cardDetail.mockRejectedValue(new Error('API 502: GitHub GET 403'));
    renderPanel();

    expect(
      await screen.findByText(/não foi possível ler esta issue no github/i),
    ).toBeInTheDocument();
    // O que o cache do board tem continua visível — nunca painel em branco.
    // A coluna aparece duas vezes de propósito (cabeçalho + bloco do cache),
    // então a asserção conta em vez de exigir instância única.
    expect(screen.getAllByText('Em Andamento').length).toBeGreaterThan(0);
    expect(screen.getByText('média')).toBeInTheDocument();
    expect(screen.getByText('RodReis')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
    // A mensagem crua fica: rate limit e permissão pedem ações diferentes.
    expect(screen.getByText(/GitHub GET 403/)).toBeInTheDocument();
  });

  it('"tentar de novo" refaz a leitura e sai do modo degradado', async () => {
    cardDetail.mockRejectedValueOnce(new Error('API 502: falhou'));
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /tentar de novo/i }),
    );

    expect(await screen.findByText('O problema')).toBeInTheDocument();
    expect(cardDetail).toHaveBeenCalledTimes(2);
  });

  it('refreshNonce novo relê o card — título editado aparece sem F5', async () => {
    const { rerender } = render(
      <CardDetailPanel
        card={card}
        projectId="p1"
        canEdit
        refreshNonce={0}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    await screen.findByText('O problema');

    cardDetail.mockResolvedValue(detail({ title: 'Título novo' }));
    rerender(
      <CardDetailPanel
        card={card}
        projectId="p1"
        canEdit
        refreshNonce={1}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(await screen.findByText('Título novo')).toBeInTheDocument();
    expect(cardDetail).toHaveBeenCalledTimes(2);
  });

  it('exibe o carimbo da leitura ao vivo', async () => {
    renderPanel();
    expect(await screen.findByText(/leitura ao vivo em/i)).toBeInTheDocument();
  });
});
