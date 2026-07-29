import type {
  AcceptanceChannel,
  ContractLinkInfo,
  ContractModality,
  ContractSummary,
  ProviderProfileView,
  TemplateSummary,
} from '../../lib/api';
import type { LinkState } from './clientDetailView';

/**
 * Regras de leitura dos contratos (SPEC-034), **fora do React**.
 *
 * Mesmo motivo do `estimatesView.ts` e do `artifactsView.ts`: é a classe de
 * defeito que produz uma tela **plausível e errada** — um rótulo que diz
 * "aceito" sobre contrato sem aceite, uma modalidade destravada que o servidor
 * vai recusar, um link vencido com cara de ativo. Nada disso quebra a tela, e
 * por isso nada disso aparece em revisão visual.
 *
 * **O estado do link não é reimplementado aqui.** `LinkState`,
 * `LINK_STATE_LABEL`, `generateLabel`, `canRevoke` e `needsRegenerateConfirm`
 * vêm do `clientDetailView.ts`: o link do contrato tem o mesmo ciclo de vida do
 * link de briefing, e uma segunda cópia do vocabulário divergiria na primeira
 * correção — que é exatamente o que o comentário do `estimatesView.ts` chama de
 * segunda implementação da regra.
 */

export const MODALITY_LABELS: Record<ContractModality, string> = {
  desenvolvimento: 'Desenvolvimento',
  desenvolvimento_manutencao: 'Desenvolvimento + manutenção',
  desenvolvimento_venda_codigo: 'Desenvolvimento + venda do código',
};

export function modalityLabel(modality: ContractModality): string {
  return MODALITY_LABELS[modality] ?? modality;
}

/**
 * Canais de aceite, na ordem de exibição. **Lista fechada** (§2.10): texto livre
 * viraria `whatsapp`, `WhatsApp`, `zap` e `wpp` na mesma coluna, e *"por qual
 * canal os contratos costumam ser aceitos?"* deixaria de ter resposta.
 */
export const ACCEPTANCE_CHANNELS: ReadonlyArray<{
  key: AcceptanceChannel;
  label: string;
}> = [
  { key: 'email', label: 'E-mail' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'presencial', label: 'Presencial' },
  { key: 'telefone', label: 'Telefone' },
];

export function channelLabel(channel: AcceptanceChannel): string {
  return ACCEPTANCE_CHANNELS.find((c) => c.key === channel)?.label ?? channel;
}

/** Estados do funil em que a aba de contratos aparece (§2.6). */
export const ESTADOS_COM_CONTRATO = [
  'CONTRACT_PENDING',
  'CONTRACT_APPROVED',
  'IN_PRODUCTION',
  'DELIVERED',
];

/**
 * O motivo pelo qual emitir está bloqueado — ou `null` quando pode emitir.
 *
 * Espelha a ordem das recusas do servidor (**template, perfil**), e existe para
 * a pessoa ler o motivo **antes** de clicar, não depois de um 422. O servidor
 * recusa de qualquer jeito: isto é conveniência, não a garantia.
 *
 * O escopo e a estimativa aprovados **não** são checados aqui: a tela não tem
 * esses dados em mãos, e inventar um "provavelmente falta estimativa" seria
 * pior que a recusa legível que o servidor já devolve.
 */
export function issueBlockedReason(
  perfil: ProviderProfileView | null,
  template: TemplateSummary | undefined,
): string | null {
  if (!perfil?.exists) {
    return 'Preencha o perfil do prestador antes de emitir um contrato.';
  }
  if (!template) return 'Modalidade desconhecida.';
  if (!template.readyToIssue) {
    return 'Edite e salve o template desta modalidade antes de emitir o primeiro contrato.';
  }
  return null;
}

/**
 * Estado do link do contrato, no vocabulário já usado pelo briefing.
 *
 * `active: false` e `status: 'invalid'` colapsam em `nenhum` pelo mesmo motivo
 * de lá: para quem olha a tela, "não existe" e "existe mas não vale nada" pedem
 * a mesma ação.
 */
export function contractLinkState(info: ContractLinkInfo | null): LinkState {
  if (!info || !info.active) return 'nenhum';
  if (info.status === 'revoked') return 'revogado';
  if (info.status === 'expired') return 'expirado';
  if (info.status === 'valid') return 'valido';
  return 'nenhum';
}

/**
 * Um contrato foi aceito? Lê `acceptedAt`, nunca o estado do card.
 *
 * A distinção importa: o card pode estar em `CONTRACT_APPROVED` por uma versão
 * **anterior** do contrato. Dizer "aceito" sobre a v3 porque a v1 foi aceita
 * seria afirmar um fato que não aconteceu.
 */
export function isAccepted(contrato: ContractSummary): boolean {
  return contrato.acceptedAt !== null;
}

/**
 * Rótulo da versão do contrato na lista.
 *
 * O aceite aparece **por versão**, com data — não como um selo do projeto.
 */
export function contractLabel(contrato: ContractSummary): string {
  const base = `v${contrato.version} · ${modalityLabel(contrato.modality)}`;
  return isAccepted(contrato) ? `${base} · aceito` : base;
}

/**
 * Data curta a partir do ISO, no fuso de quem lê.
 *
 * `null` vira "—" e **nunca** a data de hoje: um `new Date(null)` renderizaria
 * 1970 ou o instante atual, e as duas coisas mentem sobre um campo vazio.
 */
export function shortDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Horas com no máximo 2 casas, como no `estimatesView`. Nunca faz aritmética. */
export function horas(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return `${valor} h`;
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
}

/** BRL a partir da string do servidor. Nunca faz aritmética (§6). */
export function brl(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

/**
 * O perfil está completo o bastante para salvar? Só o obrigatório do servidor —
 * nome e documento. O resto é opcional por decisão do §2.1.
 */
export function isValidProfile(input: {
  legalName: string;
  document: string;
}): boolean {
  return input.legalName.trim() !== '' && input.document.trim() !== '';
}

/**
 * Os 12 placeholders aceitos (§2.4). Serve para a tela **listar** o que existe,
 * ao lado do editor — não para validar: quem valida é o servidor, ao salvar, e
 * duplicar a lista aqui criaria duas verdades que divergem.
 */
export const PLACEHOLDERS: readonly string[] = [
  'provider_name',
  'provider_document',
  'provider_address',
  'client_name',
  'client_document',
  'client_address',
  'scope',
  'budget',
  'effort_hours',
  'payment_terms',
  'date',
  'modality',
];
