import type { MailDeliveryOpsView } from '../../lib/api';

/**
 * Lógica de apresentação das entregas de e-mail (FIX #254).
 *
 * Fora do componente pelo motivo de sempre nesta casa: o que decide o que a
 * tela **afirma** deve ser testável sem montar React.
 *
 * A pergunta aqui é irmã da do webhook, e distinta: aquele responde *"a venda
 * virou licença?"*; este, *"a chave chegou ao comprador?"*. Um rótulo errado
 * aqui faz o operador achar que entregou o que não entregou.
 */

/** Rótulo em português do status da entrega. */
export function mailStatusLabel(status: string): string {
  if (status === 'SENT') return 'Enviada';
  if (status === 'FAILED') return 'Falhou';
  if (status === 'PENDING') return 'Aguardando';
  return status;
}

/**
 * Tom do badge. `PENDING` é **neutro, não alerta**: o job vai pegar, e pintá-lo
 * de vermelho faria o dono caçar problema no caminho normal. `FAILED` é o único
 * que pede ação.
 */
export function mailStatusTone(status: string): 'ok' | 'alert' | 'muted' {
  if (status === 'SENT') return 'ok';
  if (status === 'FAILED') return 'alert';
  return 'muted';
}

/**
 * Nome do template em linguagem de quem opera.
 *
 * O valor cru (`license_key`) é o identificador do código; numa lista de
 * pendências ele obriga a traduzir mentalmente qual e-mail não chegou — e é
 * justamente essa a informação mais urgente da linha.
 *
 * Template desconhecido devolve o próprio nome: inventar um rótulo genérico
 * ("E-mail do sistema") esconderia que apareceu algo que esta tela não conhece.
 */
export function templateLabel(template: string): string {
  if (template === 'license_key') return 'Chave da licença';
  if (template === 'license_revoked') return 'Licença encerrada';
  if (template === 'source_username_request') return 'Pedido do usuário do GitHub';
  if (template === 'source_username_confirmed') return 'Confirmação do usuário do GitHub';
  return template;
}

/**
 * O que o dono precisa ler numa entrega que falhou.
 *
 * Mesmo desenho do webhook: o fallback não é genérico de propósito — *"falhou
 * sem mensagem"* é uma informação real (e um defeito nosso), enquanto "erro
 * desconhecido" soaria como estado normal.
 */
export function mailErrorText(entrega: MailDeliveryOpsView): string | null {
  if (entrega.status !== 'FAILED') return null;
  return entrega.error?.trim() || 'Falhou sem mensagem registrada';
}

/**
 * Quantas entregas pedem ação — o número do badge da seção.
 *
 * Conta só `FAILED`, pelo mesmo motivo do webhook: `PENDING` está no caminho
 * normal, e somá-lo faria o badge acender toda vez que uma venda acabou de
 * chegar.
 */
export function failedCount(entregas: MailDeliveryOpsView[]): number {
  return entregas.filter((e) => e.status === 'FAILED').length;
}

/**
 * Quantas tentativas o BullMQ já gastou, em texto.
 *
 * É o que distingue *"falhou uma vez e o retry resolve"* de *"falhou cinco
 * vezes e alguém precisa olhar"* — a razão de a coluna existir no schema.
 * `0` não vira "0 tentativas": a entrega ainda não foi tentada, e o número solto
 * seria lido como falha.
 */
export function attemptsLabel(attempts: number): string | null {
  if (attempts <= 0) return null;
  return `${attempts} ${attempts === 1 ? 'tentativa' : 'tentativas'}`;
}
