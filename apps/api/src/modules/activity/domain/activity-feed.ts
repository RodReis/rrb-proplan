/**
 * Projeção de leitura do histórico de Atividade (SPEC-010, Camada 2). NÃO é uma
 * tabela de eventos — compõe o que já existe no banco (Operation, Insight,
 * BoardMutation, SyncRun), aplicando ADR-017 internamente: uma fonte por fato.
 *
 * Puro e testável: recebe as linhas das 4 fontes, devolve a lista unificada
 * ordenada por data (reverso). O service só busca as linhas e chama isto.
 */

import { columnTitle } from '../../../shared/convention/columns';

export type ActivityKind = 'operation' | 'insight' | 'board_mutation' | 'sync';

export interface ActivityItem {
  /** id único no feed (prefixado pela fonte, para key estável no front). */
  id: string;
  kind: ActivityKind;
  /** ISO — o front formata "há 2 min". */
  at: string;
  /** O que o ProPlan fez, em linguagem de gente. */
  title: string;
  detail: string | null;
  /** Link clicável de evidência (commit, issue) — ou null. */
  evidenceUrl: string | null;
}

// --- Linhas cruas de cada fonte (o mínimo que o mapeamento precisa) ---

export interface OperationRow {
  id: string;
  kind: string; // promote | mapping | bootstrap
  status: string; // running | done | failed
  commitUrl: string | null;
  startedAt: Date;
}
export interface InsightRow {
  id: string;
  kind: string; // summary | architecture_fallback | ...
  provider: string;
  model: string;
  createdAt: Date;
  /** JSON persistido — de onde sai a contagem do resultado (hits, count). */
  content: unknown;
}
export interface BoardMutationRow {
  id: string;
  type: string; // move_column | create_card | edit_card | discard_card
  payload: unknown;
  status: string;
  createdAt: Date;
  issueUrl: string | null; // montada pelo service (owner/repo/number)
}
export interface SyncRunRow {
  id: string;
  status: string; // success | noop | failed | ...
  added: number;
  updated: number;
  removed: number;
  startedAt: Date;
}

const OPERATION_TITLE: Record<string, string> = {
  promote: 'Promoveu um documento inferido a fonte',
  mapping: 'Salvou o mapeamento de documentos',
  bootstrap: 'Criou cards no board a partir da documentação',
};

// Título fixo dos insights que produzem um artefato de texto (o resumo, a aba
// inferida, o backlog proposto) — o resultado é o próprio artefato, não uma
// contagem. Os que produzem uma coleção (docs classificados, ligações) carregam
// o número no título via insightTitle().
const INSIGHT_TITLE: Record<string, string> = {
  summary: 'Gerou o resumo do projeto por IA',
  architecture_fallback: 'Inferiu a Arquitetura por IA',
  design_fallback: 'Inferiu o Design por IA',
  status_bootstrap: 'Propôs um backlog por IA',
};

/** Nº de itens do resultado, do content persistido (nunca de nova inferência). */
function insightCount(kind: string, content: unknown): number | null {
  const c = (content ?? {}) as { hits?: unknown[]; count?: number };
  if (kind === 'classify_marker') return Array.isArray(c.hits) ? c.hits.length : null;
  if (kind === 'edges_marker') return typeof c.count === 'number' ? c.count : null;
  return null;
}

/**
 * Título do insight com o resultado embutido. "Classificou N documentos",
 * "Inferiu N ligações" — o número vem do artefato persistido. Sem número (0 ou
 * ausente), cai no texto neutro; nunca "Classificou documentos" sem contagem
 * quando ela existe (SPEC-010: linha sem resultado é log, não evidência).
 */
function insightTitle(row: InsightRow): string {
  const n = insightCount(row.kind, row.content);
  if (row.kind === 'classify_marker') {
    return n == null ? 'Classificou documentos por IA' : `Classificou ${n} documento${n === 1 ? '' : 's'} por IA`;
  }
  if (row.kind === 'edges_marker') {
    return n == null ? 'Inferiu ligações entre documentos por IA' : `Inferiu ${n} ligaç${n === 1 ? 'ão' : 'ões'} entre documentos por IA`;
  }
  return INSIGHT_TITLE[row.kind] ?? 'Chamada de IA';
}

function mutationTitle(type: string, payload: unknown): string {
  const p = (payload ?? {}) as { number?: number; toColumn?: string; title?: string };
  switch (type) {
    case 'move_column': {
      const col = p.toColumn ? columnTitle(p.toColumn) : 'outra coluna';
      return `Moveu a issue #${p.number} para ${col}`;
    }
    case 'create_card':
      return `Criou o card "${p.title ?? ''}"`;
    case 'edit_card':
      return `Editou a issue #${p.number}`;
    case 'discard_card':
      return `Descartou a issue #${p.number}`;
    default:
      return 'Atualizou o board';
  }
}

function syncTitle(r: SyncRunRow): string {
  if (r.status === 'failed') return 'Sincronização falhou';
  if (r.status === 'noop') return 'Sincronizou — nada mudou';
  const parts = [
    r.added && `${r.added} novo${r.added > 1 ? 's' : ''}`,
    r.updated && `${r.updated} atualizado${r.updated > 1 ? 's' : ''}`,
    r.removed && `${r.removed} removido${r.removed > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return parts.length ? `Sincronizou — ${parts.join(', ')}` : 'Sincronizou';
}

/**
 * Compõe o feed unificado a partir das 4 fontes. `syncs` só entra quando o
 * toggle "mostrar syncs" está ligado (senão o feed enche de "nada mudou").
 * Ordena por data reversa. NÃO pagina aqui — o service já limita por cursor.
 */
export function buildFeed(sources: {
  operations: OperationRow[];
  insights: InsightRow[];
  mutations: BoardMutationRow[];
  syncs: SyncRunRow[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const o of sources.operations) {
    items.push({
      id: `op:${o.id}`,
      kind: 'operation',
      at: o.startedAt.toISOString(),
      title: OPERATION_TITLE[o.kind] ?? 'Escreveu no repositório',
      detail: o.status === 'failed' ? 'Falhou' : o.status === 'running' ? 'Em andamento' : null,
      evidenceUrl: o.commitUrl,
    });
  }
  for (const i of sources.insights) {
    items.push({
      id: `ai:${i.id}`,
      kind: 'insight',
      at: i.createdAt.toISOString(),
      title: insightTitle(i),
      detail: `${i.provider}/${i.model}`,
      evidenceUrl: null,
    });
  }
  for (const m of sources.mutations) {
    items.push({
      id: `bm:${m.id}`,
      kind: 'board_mutation',
      at: m.createdAt.toISOString(),
      title: mutationTitle(m.type, m.payload),
      detail: m.status === 'failed' ? 'Falhou' : null,
      evidenceUrl: m.issueUrl,
    });
  }
  for (const s of sources.syncs) {
    items.push({
      id: `sync:${s.id}`,
      kind: 'sync',
      at: s.startedAt.toISOString(),
      title: syncTitle(s),
      detail: null,
      evidenceUrl: null,
    });
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
