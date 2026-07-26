/**
 * Detalhe de card (SPEC-030) — tradução pura do payload do GitHub para o
 * contrato da API. Sem Prisma, sem HTTP, sem Nest: o que decide *o que aparece
 * na trilha* é regra, e regra se testa sem rede.
 *
 * **Nada disto é persistido** (ADR-017): corpo e trilha mudam sem que nada nos
 * avise (sem webhooks — ADR-009), então uma cópia nossa seria a segunda fonte
 * defasada de um fato que o GitHub serve ao vivo.
 */
import type {
  GithubActor,
  GithubIssueDetail,
  GithubTimelineEvent,
} from '../infrastructure/github-issues.client';

/** Os 8 tipos de evento do contrato. Qualquer outro é descartado. */
export type CardEventType =
  | 'opened'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'closed'
  | 'reopened'
  | 'renamed';

export interface CardActor {
  login: string;
  avatarUrl: string;
}

export interface CardEvent {
  type: CardEventType;
  actor: CardActor | null;
  createdAt: string;
  label?: { name: string; color: string };
  assignee?: { login: string };
  rename?: { from: string; to: string };
}

export interface CardDetail {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  body: string | null;
  author: CardActor | null;
  assignees: CardActor[];
  labels: { name: string; color: string }[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  timeline: CardEvent[];
  /** Carimbo da leitura ao vivo — a UI mostra para o humano saber que é agora. */
  fetchedAt: string;
}

const MAPPED_EVENTS = new Set<CardEventType>([
  'opened',
  'assigned',
  'unassigned',
  'labeled',
  'unlabeled',
  'closed',
  'reopened',
  'renamed',
]);

function isMapped(event: string): event is CardEventType {
  return MAPPED_EVENTS.has(event as CardEventType);
}

function toActor(actor: GithubActor | null | undefined): CardActor | null {
  return actor ? { login: actor.login, avatarUrl: actor.avatar_url } : null;
}

/**
 * Traduz a timeline do GitHub para os eventos do contrato, em ordem
 * cronológica.
 *
 * Três descartes deliberados:
 * - **tipo fora dos 8** — `commented`, `mentioned`, `cross-referenced` e a dúzia
 *   de outros que o GitHub devolve não são ficha do card (decisão do PI);
 * - **evento sem `created_at`** — sem carimbo não há como ordenar nem exibir;
 *   alguns eventos do GitHub vêm sem ele, e um `new Date(undefined)` viraria
 *   "Invalid Date" na tela;
 * - **`labeled`/`unlabeled` sem `label`** — o payload seria inútil na trilha
 *   ("alguém rotulou com nada").
 */
export function mapTimeline(raw: GithubTimelineEvent[]): CardEvent[] {
  const events: CardEvent[] = [];

  for (const e of raw) {
    if (!isMapped(e.event) || !e.created_at) continue;
    if ((e.event === 'labeled' || e.event === 'unlabeled') && !e.label) continue;

    events.push({
      type: e.event,
      actor: toActor(e.actor),
      createdAt: e.created_at,
      ...(e.label ? { label: { name: e.label.name, color: e.label.color } } : {}),
      ...(e.assignee ? { assignee: { login: e.assignee.login } } : {}),
      ...(e.rename ? { rename: { from: e.rename.from, to: e.rename.to } } : {}),
    });
  }

  // A timeline do GitHub já vem cronológica, mas o contrato promete a ordem —
  // depender da API para uma garantia que declaramos sai caro quando ela muda.
  return events.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/**
 * Monta o payload do endpoint. `fetchedAt` entra por parâmetro (não
 * `new Date()` aqui dentro) para o teste poder afirmar o valor.
 */
export function toCardDetail(
  issue: GithubIssueDetail,
  timeline: GithubTimelineEvent[],
  fetchedAt: Date,
): CardDetail {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    htmlUrl: issue.html_url,
    // String vazia é "sem descrição", igual a ausente — a UI trata os dois como
    // um caso só, e normalizar aqui evita `body === ''` vazando para a tela.
    body: issue.body?.trim() ? issue.body : null,
    author: toActor(issue.user),
    assignees: (issue.assignees ?? []).map((a) => ({
      login: a.login,
      avatarUrl: a.avatar_url,
    })),
    labels: (issue.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    timeline: mapTimeline(timeline),
    fetchedAt: fetchedAt.toISOString(),
  };
}
