import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactVersionDetail, ArtifactsOverview } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  getArtifacts: vi.fn(),
  getArtifactVersion: vi.fn(),
  approveArtifact: vi.fn(),
  rejectArtifact: vi.fn(),
  createArtifactVersion: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { ArtifactsPanel } = await import('./ArtifactsPanel');

/**
 * Artefatos no painel (SPEC-032 §2.12).
 *
 * O que estes testes protegem, em ordem de importância:
 *
 *   - **o parecer do revisor NÃO desabilita o botão de aprovar** — é a decisão 1
 *     do PI em pixels. Um veredito negativo é informação para a pessoa decidir,
 *     nunca um bloqueio; se o botão desabilitasse, a IA teria poder de veto por
 *     via indireta, que é o oposto do MVP3 §6;
 *   - **editar promete versão nova**, não alteração no lugar (§2.10);
 *   - **"não gerado" ≠ "falhou"** — ausência é informação (MVP3 §9);
 *   - **o custo diz que vem do ledger**, nunca de estimativa (ADR-016).
 */

const overview: ArtifactsOverview = {
  artifacts: [
    {
      id: 'art-normalize',
      kind: 'normalize',
      state: 'PENDING_REVIEW',
      currentVersionId: 'av-1',
      rejectionReason: null,
      reviewedAt: null,
      reviewedBy: null,
      versions: [
        {
          id: 'av-1',
          version: 1,
          author: 'ai',
          model: 'claude-haiku-4-5-20251001',
          promptVersion: 'normalize@1',
          editedBy: null,
          parentVersionId: null,
          createdAt: '2026-07-28T10:00:00.000Z',
        },
      ],
    },
    { kind: 'scope', state: null, versions: [] },
    { kind: 'requirements', state: null, versions: [] },
    { kind: 'site_prompt', state: null, versions: [] },
  ],
  run: {
    id: 'run-1',
    status: 'COMPLETED',
    completedKinds: ['normalize'],
    failureReason: null,
    startedAt: '2026-07-28T09:59:00.000Z',
    finishedAt: '2026-07-28T10:00:00.000Z',
  },
  approvedCount: 0,
  requiredCount: 4,
  costUsd: '0.0123',
};

/** Versão com parecer NEGATIVO — o caso que a decisão 1 do PI governa. */
const versaoComParecerRuim: ArtifactVersionDetail = {
  id: 'av-1',
  version: 1,
  author: 'ai',
  model: 'claude-haiku-4-5-20251001',
  promptVersion: 'normalize@1',
  editedBy: null,
  parentVersionId: null,
  createdAt: '2026-07-28T10:00:00.000Z',
  content: { resumo: 'um site institucional' },
  artifact: { id: 'art-normalize', kind: 'normalize', state: 'PENDING_REVIEW' },
  verdicts: [
    {
      verdict: 'incompleto',
      rationale: 'O artefato afirma prazo que o briefing não menciona.',
      model: 'claude-haiku-4-5-20251001',
      createdAt: '2026-07-28T10:00:05.000Z',
    },
  ],
};

function montar() {
  return render(
    <ArtifactsPanel projectId="cp-1" projectTitle="Site da Padaria" onClose={vi.fn()} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getArtifacts.mockResolvedValue(overview);
  apiMock.getArtifactVersion.mockResolvedValue(versaoComParecerRuim);
});

describe('ArtifactsPanel: o revisor anota, nunca bloqueia (§2.9)', () => {
  it('mostra o parecer negativo E mantém o botão de aprovar habilitado', async () => {
    // O teste mais importante do arquivo. Se um dia alguém "melhorar" a tela
    // desabilitando o botão quando o veredito é ruim, ele quebra aqui — e o
    // motivo está escrito ao lado.
    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));

    expect(await screen.findByText(/incompleto/)).toBeInTheDocument();
    expect(screen.getByText(/afirma prazo que o briefing não menciona/)).toBeInTheDocument();

    const aprovar = screen.getByRole('button', { name: 'Aprovar' });
    expect(aprovar).toBeEnabled();
  });

  it('deixa explícito na tela que o parecer é anotação', async () => {
    // Sem esta frase, a pessoa lê "incompleto" e presume que não deve aprovar —
    // o veto acontece na cabeça dela em vez de no código, e o efeito é o mesmo.
    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));

    expect(await screen.findByText(/quem decide é você/i)).toBeInTheDocument();
  });
});

describe('ArtifactsPanel: aprovar e rejeitar', () => {
  it('aprovar chama a API e recarrega', async () => {
    const user = userEvent.setup();
    apiMock.approveArtifact.mockResolvedValue({ state: 'APPROVED', cardMoved: false });
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));
    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));

    await waitFor(() => expect(apiMock.approveArtifact).toHaveBeenCalledWith('art-normalize'));
    expect(apiMock.getArtifacts).toHaveBeenCalledTimes(2);
  });

  it('rejeitar fica desabilitado sem motivo', async () => {
    // O servidor recusa rejeição sem motivo (422). Barrar na tela evita um erro
    // que a pessoa não entenderia — e deixa claro que o motivo é obrigatório.
    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));

    expect(screen.getByRole('button', { name: 'Rejeitar' })).toBeDisabled();
  });

  it('rejeitar com motivo envia o texto', async () => {
    const user = userEvent.setup();
    apiMock.rejectArtifact.mockResolvedValue({ state: 'REJECTED', cardMoved: false });
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));
    await user.type(
      await screen.findByLabelText('Motivo da rejeição'),
      'faltou o público-alvo',
    );
    await user.click(screen.getByRole('button', { name: 'Rejeitar' }));

    await waitFor(() =>
      expect(apiMock.rejectArtifact).toHaveBeenCalledWith(
        'art-normalize',
        'faltou o público-alvo',
      ),
    );
  });

  it('avisa o pai quando a aprovação move o card', async () => {
    // Aprovar o 4º move o card no funil (§2.7). Sem este aviso, o quadro atrás
    // ficaria desatualizado até um F5 — o bug que a frente já pagou uma vez.
    const user = userEvent.setup();
    const onCardMoved = vi.fn();
    apiMock.approveArtifact.mockResolvedValue({ state: 'APPROVED', cardMoved: true });
    render(
      <ArtifactsPanel
        projectId="cp-1"
        projectTitle="Site da Padaria"
        onClose={vi.fn()}
        onCardMoved={onCardMoved}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Ver' }));
    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));

    await waitFor(() => expect(onCardMoved).toHaveBeenCalled());
  });
});

describe('ArtifactsPanel: edição cria versão (§2.10)', () => {
  it('a tela promete versão nova, não alteração', async () => {
    // A promessa em tela precisa bater com o que a API faz. "Salvar" sem esta
    // frase daria a entender que o texto da IA seria sobrescrito.
    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    expect(screen.getByText(/cria uma versão nova/i)).toBeInTheDocument();
    expect(screen.getByText(/versão da IA continua guardada/i)).toBeInTheDocument();
  });

  it('salvar envia a versão de origem como pai', async () => {
    const user = userEvent.setup();
    apiMock.createArtifactVersion.mockResolvedValue({ id: 'av-2', version: 2 });
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: /Salvar como versão nova/ }));

    await waitFor(() =>
      expect(apiMock.createArtifactVersion).toHaveBeenCalledWith(
        'art-normalize',
        'av-1',
        { resumo: 'um site institucional' },
      ),
    );
  });

  it('JSON inválido não chega ao servidor', async () => {
    // A mensagem fica ao lado do campo, onde a pessoa está olhando — e não
    // gasta um 400 para dizer o que a tela já sabe.
    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('button', { name: 'Ver' }));
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    const campo = screen.getByLabelText(/Conteúdo/);
    await user.clear(campo);
    await user.type(campo, '{{ isso não é json');
    await user.click(screen.getByRole('button', { name: /Salvar como versão nova/ }));

    expect(await screen.findByText(/JSON válido/i)).toBeInTheDocument();
    expect(apiMock.createArtifactVersion).not.toHaveBeenCalled();
  });
});

describe('ArtifactsPanel: o que a tela diz sobre estado e custo', () => {
  it('mostra os 4 tipos mesmo com 3 não gerados', async () => {
    // Lista curta faria a tela mostrar 1 cartão sem dizer que faltam 3 —
    // ausência é informação (ADR-014).
    montar();

    expect(await screen.findByText('Briefing normalizado')).toBeInTheDocument();
    expect(screen.getByText('Escopo')).toBeInTheDocument();
    expect(screen.getByText('Requisitos')).toBeInTheDocument();
    expect(screen.getByText('Prompt do site')).toBeInTheDocument();
    expect(screen.getAllByText('não gerado')).toHaveLength(3);
  });

  it('diz por que o card não andou', async () => {
    montar();

    expect(await screen.findByText(/faltam 4 de 4/)).toBeInTheDocument();
  });

  it('o custo se identifica como vindo do ledger', async () => {
    // ADR-016: o ledger é a fonte. A tela não pode sugerir que é estimativa.
    montar();

    expect(await screen.findByText(/US\$ 0.0123/)).toBeInTheDocument();
    expect(screen.getByText(/do ledger/)).toBeInTheDocument();
  });

  it('não oferece Ver para artefato sem versão', async () => {
    // Oferecer levaria a um erro numa ação que a tela sugeriu.
    montar();

    expect(await screen.findAllByRole('button', { name: 'Ver' })).toHaveLength(1);
  });
});
