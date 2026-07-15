/**
 * Projeção de leitura do histórico de Atividade (SPEC-010, Camada 2). NÃO é uma
 * tabela de eventos — compõe o que já existe no banco (Operation, Insight,
 * BoardMutation, SyncRun), aplicando ADR-017 internamente: uma fonte por fato.
 *
 * Puro e testável: recebe as linhas das 4 fontes, devolve a lista unificada
 * ordenada por data (reverso). O service só busca as linhas e chama isto.
 */

import { columnTitle } from '../../../shared/convention/columns';

export type ActivityKind = 'operation' | 'insight_run' | 'board_mutation' | 'sync';

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
  /** Tokens/custo, só nas linhas de IA `generated` (SPEC-011). null quando não se aplica. */
  cost?: { inputTokens: number; outputTokens: number; costUsd: string | null } | null;
}

// --- Linhas cruas de cada fonte (o mínimo que o mapeamento precisa) ---

export interface OperationRow {
  id: string;
  kind: string; // promote | mapping | bootstrap
  status: string; // running | done | failed
  commitUrl: string | null;
  startedAt: Date;
}
export interface InsightRunRow {
  id: string;
  kind: string; // summary | edges_marker | classify_marker | architecture_fallback | ...
  outcome: string; // generated | reused | failed
  createdAt: Date;
  /** Nº de documentos que entraram no prompt (só `generated`; null em `reused`/antigos). */
  docsRead?: number | null;
  /** Tokens/custo da chamada que este run disparou (só em `generated`; null em `reused`). */
  cost?: { inputTokens: number; outputTokens: number; costUsd: string | null } | null;
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
  assertion: 'Registrou contexto em docs/CONTEXT.md',
};

// O QUE cada job de insight produz, em linguagem de gente — o objeto direto do
// verbo (gerou/reaproveitou/falhou). SPEC-011: a fonte do feed passou a ser o
// InsightRun (uma linha por execução), não mais o artefato Insight — por isso o
// feed distingue gerado × reaproveitado (a economia da 7.7 precisa ser visível).
const INSIGHT_NOUN: Record<string, string> = {
  summary: 'o resumo do projeto',
  edges_marker: 'as ligações entre documentos',
  classify_marker: 'a classificação de documentos',
  architecture_fallback: 'a Arquitetura',
  design_fallback: 'o Design',
  status_bootstrap: 'o backlog de cards',
};

/**
 * Título de uma execução de job de insight, por resultado. `generated` = a IA
 * rodou; `reused` = o input não mudou, reaproveitou sem gastar (a economia da
 * 7.7); `failed` = a chamada falhou. Sem jargão (SPEC-010).
 */
function insightRunTitle(row: InsightRunRow): string {
  const noun = INSIGHT_NOUN[row.kind] ?? 'uma inferência';
  switch (row.outcome) {
    case 'reused':
      return `Reaproveitou ${noun} — nada mudou desde a última vez`;
    case 'failed':
      return `Falhou ao inferir ${noun} por IA`;
    default:
      return `Gerou ${noun} por IA`;
  }
}

/**
 * Detalhe da linha de IA. `reused` = deixou explícito que não custou. `generated`
 * = docs lidos + tokens gastos (SPEC-011: a economia só é crível se o gasto de
 * quando SE gasta também aparece). Gasto exibido em TOKENS, não em dinheiro — o
 * valor em US$ vive na aba Uso de IA (decisão do PI: o cifrão no feed assusta).
 */
function insightRunDetail(row: InsightRunRow): string | null {
  if (row.outcome === 'reused') return 'Sem chamar a IA (sem custo)';
  if (row.outcome === 'failed') return null;
  const parts: string[] = [];
  if (typeof row.docsRead === 'number') {
    parts.push(`leu ${row.docsRead} documento${row.docsRead === 1 ? '' : 's'}`);
  }
  const c = row.cost;
  if (c) {
    parts.push(`${c.inputTokens.toLocaleString('pt-BR')} tokens de entrada · ${c.outputTokens.toLocaleString('pt-BR')} de saída`);
  }
  return parts.length ? parts.join(' · ') : null;
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
  insightRuns: InsightRunRow[];
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
  for (const r of sources.insightRuns) {
    items.push({
      id: `ai:${r.id}`,
      kind: 'insight_run',
      at: r.createdAt.toISOString(),
      title: insightRunTitle(r),
      detail: insightRunDetail(r),
      evidenceUrl: null,
      cost: r.cost ?? null,
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
