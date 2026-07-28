import { describe, expect, it } from 'vitest';
import type { ArtifactSummary, ArtifactsOverview, ArtifactVersionRef } from '../../lib/api';
import {
  authorLabel,
  canEdit,
  canReview,
  costLabel,
  kindLabel,
  progress,
  stateLabel,
} from './artifactsView';

const versaoIa: ArtifactVersionRef = {
  id: 'av-1',
  version: 1,
  author: 'ai',
  model: 'claude-haiku-4-5-20251001',
  promptVersion: 'scope@1',
  editedBy: null,
  parentVersionId: null,
  createdAt: '2026-07-28T10:00:00.000Z',
};

const artefato = (over: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id: 'art-1',
  kind: 'scope',
  state: 'PENDING_REVIEW',
  versions: [versaoIa],
  ...over,
});

const overview = (over: Partial<ArtifactsOverview> = {}): ArtifactsOverview => ({
  artifacts: [artefato()],
  run: null,
  approvedCount: 0,
  requiredCount: 4,
  costUsd: null,
  ...over,
});

describe('stateLabel: não gerado ≠ falhou', () => {
  it('distingue "não gerado" de "falhou"', () => {
    // MVP3 §9: zero é resultado, ausência é outra coisa. Colapsar os dois faria
    // "ainda não usei" parecer "usei e deu errado" — e a pessoa iria procurar um
    // erro que não existe.
    expect(stateLabel(null)).toBe('não gerado');
    expect(stateLabel('FAILED')).toBe('falhou');
    expect(stateLabel(null)).not.toBe(stateLabel('FAILED'));
  });

  it.each([
    ['PENDING_REVIEW', 'aguardando revisão'],
    ['APPROVED', 'aprovado'],
    ['REJECTED', 'rejeitado'],
  ] as const)('traduz %s', (state, esperado) => {
    expect(stateLabel(state)).toBe(esperado);
  });
});

describe('kindLabel: os 4 tipos têm nome em português', () => {
  it.each(['normalize', 'scope', 'requirements', 'site_prompt'] as const)(
    '%s tem rótulo legível',
    (kind) => {
      const label = kindLabel(kind);
      expect(label).toBeTruthy();
      // O bug de 5 ocorrências nesta frente: a tela mostrando o CÓDIGO em vez do
      // rótulo (`Segmento: G`, `alta` em vez de "Alta").
      expect(label).not.toBe(kind);
    },
  );
});

describe('canReview / canEdit', () => {
  it('só PENDING_REVIEW pode ser aprovado ou rejeitado', () => {
    expect(canReview(artefato({ state: 'PENDING_REVIEW' }))).toBe(true);
    expect(canReview(artefato({ state: 'APPROVED' }))).toBe(false);
    expect(canReview(artefato({ state: 'FAILED' }))).toBe(false);
    expect(canReview(artefato({ state: null }))).toBe(false);
  });

  it('editar exige uma versão de origem', () => {
    // Sem versão não há pai para a edição derivar, e oferecer o botão levaria a
    // um erro do servidor numa ação que a tela sugeriu.
    expect(canEdit(artefato({ versions: [] }))).toBe(false);
    expect(canEdit(artefato())).toBe(true);
  });
});

describe('authorLabel: a linhagem precisa ser legível', () => {
  it('distingue IA de pessoa', () => {
    // §7.4.1: o artefato deixa de ser "saída da IA" e passa a ser "linhagem,
    // cada elo com autor". Sem isso ninguém sabe o que o modelo produziu.
    expect(authorLabel(versaoIa)).toMatch(/IA/);
    expect(authorLabel({ ...versaoIa, author: 'human' })).toMatch(/pessoa/);
  });
});

describe('progress: por que o card não andou', () => {
  it('completo quando os 4 estão aprovados', () => {
    const p = progress(overview({ approvedCount: 4 }));
    expect(p.complete).toBe(true);
    expect(p.blocked).toBeNull();
  });

  it('3 de 4 não completa e diz quantas faltam', () => {
    const p = progress(overview({ approvedCount: 3 }));
    expect(p.complete).toBe(false);
    expect(p.blocked).toMatch(/falta.*1 de 4/);
  });

  it('run FAILED mostra o motivo que veio do servidor', () => {
    // O motivo é escrito no servidor, em português. Reescrevê-lo aqui criaria
    // duas versões da mesma explicação, que divergiriam na primeira mudança.
    const p = progress(
      overview({
        run: {
          id: 'r1',
          status: 'FAILED',
          completedKinds: ['normalize'],
          failureReason: 'Teto de gasto de IA do tenant atingido durante a geração.',
          startedAt: '',
          finishedAt: null,
        },
      }),
    );
    expect(p.blocked).toMatch(/Teto de gasto/);
  });

  it('run RUNNING diz que ainda está gerando', () => {
    const p = progress(
      overview({
        run: {
          id: 'r1',
          status: 'RUNNING',
          completedKinds: [],
          failureReason: null,
          startedAt: '',
          finishedAt: null,
        },
      }),
    );
    expect(p.blocked).toMatch(/andamento/);
  });

  it('artefato rejeitado é apontado como motivo', () => {
    const p = progress(
      overview({ artifacts: [artefato({ state: 'REJECTED' })], approvedCount: 3 }),
    );
    expect(p.blocked).toMatch(/rejeitado/);
  });
});

describe('costLabel: ausência ≠ zero', () => {
  it('sem run devolve null, não "US$ 0"', () => {
    // A mesma regra do estado: sem run não há custo a mostrar; com run e zero, o
    // zero é o resultado. Mostrar "US$ 0,0000" para quem nunca gerou nada seria
    // afirmar um fato que não aconteceu.
    expect(costLabel(null)).toBeNull();
  });

  it('formata o valor do ledger', () => {
    expect(costLabel('0.0123')).toBe('US$ 0.0123');
  });

  it('zero real vira "US$ 0.0000", não null', () => {
    expect(costLabel('0')).toBe('US$ 0.0000');
  });

  it('valor não-numérico devolve null em vez de NaN na tela', () => {
    expect(costLabel('abc')).toBeNull();
  });
});
