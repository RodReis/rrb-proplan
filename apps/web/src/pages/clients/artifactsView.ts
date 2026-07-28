import type {
  ArtifactKind,
  ArtifactState,
  ArtifactSummary,
  ArtifactsOverview,
  ArtifactVersionRef,
} from '../../lib/api';

/**
 * Regras de leitura dos artefatos (SPEC-032 §2.12), fora do React.
 *
 * Ficam aqui porque são o que erra sem aparecer em revisão visual: rótulo de
 * estado, distinção entre *não rodou* e *falhou*, e a contagem que autoriza
 * mover o card. Um componente com essas regras dentro só se testa renderizando.
 */

const KIND_LABELS: Record<ArtifactKind, string> = {
  normalize: 'Briefing normalizado',
  scope: 'Escopo',
  requirements: 'Requisitos',
  site_prompt: 'Prompt do site',
};

export function kindLabel(kind: ArtifactKind): string {
  return KIND_LABELS[kind];
}

/**
 * Rótulo do estado. **`null` e `FAILED` são coisas diferentes** e têm textos
 * diferentes: um nunca rodou, o outro tentou e não deu. Colapsar os dois faria
 * *"ainda não usei"* parecer *"usei e deu errado"* (MVP3 §9).
 */
export function stateLabel(state: ArtifactState | null): string {
  if (state === null) return 'não gerado';
  const labels: Record<ArtifactState, string> = {
    PENDING_REVIEW: 'aguardando revisão',
    APPROVED: 'aprovado',
    REJECTED: 'rejeitado',
    FAILED: 'falhou',
  };
  return labels[state];
}

/** Só quem está `PENDING_REVIEW` pode ser aprovado ou rejeitado. */
export function canReview(artifact: ArtifactSummary): boolean {
  return artifact.state === 'PENDING_REVIEW';
}

/**
 * Editar exige uma versão de origem. Artefato que nunca gerou versão não tem o
 * que editar — e oferecer o botão levaria a um erro do servidor.
 */
export function canEdit(artifact: ArtifactSummary): boolean {
  return artifact.versions.length > 0;
}

/** Autoria legível: é o que distingue o que a IA produziu do que a pessoa mudou. */
export function authorLabel(version: ArtifactVersionRef): string {
  return version.author === 'ai' ? 'gerado pela IA' : 'editado por uma pessoa';
}

/**
 * Resumo do progresso para o topo do painel.
 *
 * `blocked` responde *"por que o card não andou?"* — a pergunta que a pessoa
 * faz olhando a tela. Sem isso ela vê 4 cartões e nenhuma explicação.
 */
export function progress(overview: ArtifactsOverview): {
  approved: number;
  required: number;
  complete: boolean;
  blocked: string | null;
} {
  const { approvedCount, requiredCount, run } = overview;
  const complete = approvedCount >= requiredCount;

  let blocked: string | null = null;
  if (!complete) {
    if (run?.status === 'FAILED') {
      // O motivo vem do servidor, em português (teto estourado, schema
      // inválido). Reescrevê-lo aqui criaria duas versões da mesma explicação.
      blocked = run.failureReason ?? 'a geração falhou';
    } else if (run?.status === 'RUNNING') {
      blocked = 'a geração ainda está em andamento';
    } else if (overview.artifacts.some((a) => a.state === 'REJECTED')) {
      blocked = 'há artefato rejeitado';
    } else {
      blocked = `faltam ${requiredCount - approvedCount} de ${requiredCount} aprovações`;
    }
  }

  return { approved: approvedCount, required: requiredCount, complete, blocked };
}

/**
 * Custo formatado em USD. **`null` é ausência, não zero** — a diferença é a
 * mesma do estado: sem run, não há custo a mostrar; com run e zero, o número
 * zero é o resultado.
 */
export function costLabel(costUsd: string | null): string | null {
  if (costUsd === null) return null;
  const n = Number(costUsd);
  if (!Number.isFinite(n)) return null;
  return `US$ ${n.toFixed(4)}`;
}
