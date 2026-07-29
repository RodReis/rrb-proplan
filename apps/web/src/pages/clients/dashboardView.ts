import type {
  DashboardActivityEntry,
  DashboardContractCounts,
  DashboardPeriod,
  PendingItem,
  RepoBoardResult,
  RepoFailureKind,
} from '../../lib/api';

/** Os 4 períodos da lista fechada (§2.8), com o rótulo que a tela mostra. */
export const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: 'current_month', label: 'Mês corrente' },
];

export const FUNNEL_COLUMN_LABELS: Record<string, string> = {
  novo: 'Novo',
  briefing: 'Briefing',
  prompt_contrato: 'Prompt & contrato',
  producao_entrega: 'Produção & entrega',
};

/** Rótulo das colunas do board de repos — o mesmo vocabulário do Kanban. */
export const REPO_COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'A Fazer',
  doing: 'Em Andamento',
  done: 'Feito',
  finalized: 'Finalizado',
  discarded: 'Descartado',
};

export const PENDING_LABELS: Record<PendingItem['kind'], string> = {
  artifact_review: 'Artefato aguardando revisão',
  estimate: 'Estimativa pendente',
  contract_acceptance: 'Contrato sem aceite',
  stalled: 'Card parado',
};

/**
 * Para onde o item de *Esperando você* leva — ou `null` se não leva a lugar
 * nenhum (§7.3).
 *
 * **`null` não é falha, é a resposta honesta.** O §7.3 é explícito: *item cuja
 * tela de destino não existe é texto, não link*, porque um link que leva a 404
 * ensina a pessoa a desconfiar de todos os outros. Quem decide se há destino é
 * o **servidor**, no `target` do item; esta função só monta a URL.
 */
export function pendingHref(item: PendingItem, tenant: string): string | null {
  if (!item.target) return null;
  const params = new URLSearchParams({
    cliente: item.clientId,
    projeto: item.clientProjectId,
    painel: item.target,
  });
  return `/t/${tenant}/clients?${params.toString()}`;
}

/**
 * O texto de um bloco de contagem, distinguindo **zero de ausência** (§2.7).
 *
 * É o defeito mais provável desta tela, e o §5 o nomeia: `COUNT(*)` devolve `0`
 * para *"usei e deu zero"* e para *"nunca usei"*, e colapsá-los faz o segundo
 * parecer o primeiro. Quem já emitiu e teve zero no período leu um **resultado**;
 * quem nunca emitiu ainda não tem resultado nenhum.
 */
export function contractsSummary(counts: DashboardContractCounts): {
  kind: 'never' | 'zero' | 'some';
  text: string;
} {
  if (!counts.hasAny) {
    return { kind: 'never', text: 'Você ainda não emitiu contrato' };
  }
  if (counts.issued === 0) {
    return { kind: 'zero', text: 'Nenhum contrato emitido no período' };
  }
  const aceitos = `${counts.accepted} com aceite`;
  return {
    kind: 'some',
    text: `${counts.issued} emitido${counts.issued > 1 ? 's' : ''} · ${aceitos}`,
  };
}

/**
 * O texto de um repo que falhou (§2.11).
 *
 * As três razões pedem texto diferente, e **`rate_limit` é a que não pode ser
 * genérica**: o §2.11 exige que o bloco diga que o limite foi atingido e quando
 * volta — *nunca zero silencioso, que seria indistinguível de board vazio*.
 *
 * Sem horário informado, a mensagem para em *"tente mais tarde"* em vez de
 * inventar um: horário falso é pior que a ausência dele.
 */
export function repoFailureText(reason: RepoFailureKind, retryAt: string | null): string {
  if (reason === 'rate_limit') {
    return retryAt
      ? `Limite do GitHub atingido — volta às ${horaCurta(retryAt)}`
      : 'Limite do GitHub atingido — tente mais tarde';
  }
  if (reason === 'timeout') return 'O GitHub demorou demais para responder';
  return 'Não foi possível carregar';
}

/** `HH:MM` local, para a mensagem de rate limit. */
export function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** `dd/mm` — o formato dos cards do funil, reusado nas listas. */
export function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  }).format(d);
}

/**
 * Há quantos dias, em texto.
 *
 * *"Desde quando espera"* é a informação que faz a lista de pendências ser
 * acionável — um item de 40 dias e um de ontem pedem reações diferentes, e a
 * data crua obriga a pessoa a fazer a conta.
 */
export function haQuantoTempo(iso: string, agora: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dias = Math.floor((agora.getTime() - d.getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'há 1 dia';
  return `há ${dias} dias`;
}

/** Rótulo curto por tipo de trilha, para "O que andou por aqui". */
export const ACTIVITY_LABELS: Record<DashboardActivityEntry['kind'], string> = {
  funnel: 'Funil',
  audit: 'Auditoria',
  sync: 'Sync',
};

/**
 * Os tipos de `AuditEvent` em português.
 *
 * **Nasceu do dogfooding**, não do papel: a tela mostrava
 * `contract_link.accessed: 2d638f14-eeb9-4a2d-…` repetido quatro vezes, e nada
 * ali é legível para quem abre um bloco chamado *"O que andou por aqui"*. O
 * nome do evento é o fato; o UUID é o identificador da linha, que não ajuda
 * ninguém a lembrar o que estava fazendo.
 */
const AUDIT_KIND_LABELS: Record<string, string> = {
  'briefing.submitted': 'Briefing enviado',
  'briefing_attachment.uploaded': 'Anexo do briefing enviado',
  'briefing_draft.saved': 'Rascunho do briefing salvo',
  'briefing_link.created': 'Link de briefing gerado',
  'client.created': 'Cliente cadastrado',
  'client.updated': 'Cliente atualizado',
  'client_project.created': 'Projeto criado',
  'client_project.transitioned': 'Card movido no funil',
  'contract.accepted': 'Aceite de contrato registrado',
  'contract_link.accessed': 'Contrato aberto pelo cliente',
  'contract_link.created': 'Link de contrato gerado',
  'contract_link.revoked': 'Link de contrato revogado',
};

/**
 * O texto de uma linha da trilha.
 *
 * **Traduz o que conhece e não esconde o que não conhece**: tipo novo (fatia
 * futura, evento que ninguém mapeou) cai no próprio nome cru, em vez de sumir
 * da lista ou virar *"evento desconhecido"*. Sumir seria pior — o bloco existe
 * para dizer o que andou, e uma trilha que omite o que não reconhece mente por
 * omissão.
 *
 * O `subject` (UUID da linha) **não entra**: é identificador, não informação.
 */
export function activityText(entry: DashboardActivityEntry): string {
  if (entry.kind !== 'audit') return entry.detail;
  const [tipo] = entry.detail.split(':');
  return AUDIT_KIND_LABELS[tipo.trim()] ?? tipo.trim();
}

/**
 * Quantos repos foram lidos com sucesso, e quantos falharam.
 *
 * Serve o cabeçalho do bloco. **Não soma nada do funil de clientes** — o
 * ADR-023 separa os domínios, e um total que cruzasse os dois afirmaria uma
 * equivalência que não existe (§2.4).
 */
export function repoTally(repos: RepoBoardResult[]): { ok: number; failed: number } {
  return {
    ok: repos.filter((r) => r.status === 'ok').length,
    failed: repos.filter((r) => r.status === 'failed').length,
  };
}
