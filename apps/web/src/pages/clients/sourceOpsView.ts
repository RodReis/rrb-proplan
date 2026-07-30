import type { ReconcileResult, SourcePendingItem } from '../../lib/api';

/**
 * Lógica de apresentação do acesso ao repo source (SPEC-039 PR-5).
 *
 * Fora do componente pelo motivo de sempre nesta casa: o que decide o que a tela
 * **afirma** deve ser testável sem montar React.
 *
 * E aqui o que a tela afirma é mais delicado que em outras: a spec é explícita
 * (§Objetivo) que *"painel que sugira 'acesso revogado = código recuperado' mente
 * para o operador"*. Remover o colaborador **não recupera o que já foi clonado** —
 * o que acaba são os *updates*, e o mecanismo real do produto é contratual (§8 do
 * MVP4). Cada texto daqui existe para não prometer o que a remoção não faz.
 */

/** Rótulo do motivo da pendência. O `reason` vem do servidor, não é deduzido. */
export function reasonLabel(reason: SourcePendingItem['reason']): string {
  if (reason === 'awaiting_username') return 'Aguardando o comprador';
  if (reason === 'invited_not_accepted') return 'Convite não aceito';
  return 'Falhou';
}

/**
 * Tom do badge. **Só `failed` é alerta.**
 *
 * "Aguardando o comprador" e "convite não aceito" são o processo andando — o
 * comprador ainda não leu o e-mail, ou não clicou no convite do GitHub. Pintá-los
 * de vermelho faria o operador caçar defeito onde só falta gente responder, e o
 * `FAILED` de verdade (PAT expirado, 403) se perderia no meio.
 */
export function reasonTone(
  reason: SourcePendingItem['reason'],
): 'ok' | 'alert' | 'muted' {
  return reason === 'failed' ? 'alert' : 'muted';
}

/**
 * O que fazer com esta linha, em uma frase.
 *
 * É o texto que substitui o "e agora?" — cada motivo tem uma ação diferente, e
 * sem isto o operador olha um enum e adivinha.
 */
export function nextActionText(item: SourcePendingItem): string {
  if (item.reason === 'awaiting_username') {
    return 'O comprador não informou o username. Grave por ele — o link público é de uso único e não pode ser reaberto.';
  }
  if (item.reason === 'invited_not_accepted') {
    return 'O convite saiu e ainda não foi aceito. Nada a fazer, a não ser que o username esteja errado.';
  }
  return 'O GitHub recusou. Conserte a causa abaixo e reemita.';
}

/**
 * `true` quando reemitir faz sentido.
 *
 * `awaiting_username` fica de fora: sem username não há a quem convidar, e o
 * servidor recusa com `422`. Oferecer um botão que sempre falha ensina a ignorar
 * erro — então a tela nem o mostra.
 *
 * `invited_not_accepted` **também** fica de fora: o convite já está de pé, e
 * "reemitir" não o reenvia (a rodada não acha a licença, que não está em
 * `PENDING`). Um botão que não faz nada é pior que a ausência dele.
 */
export function canReinvite(item: SourcePendingItem): boolean {
  return item.reason === 'failed' && Boolean(item.githubUsername);
}

/**
 * `true` quando há acesso a remover.
 *
 * `awaiting_username` não tem: o convite nunca saiu. Mostrar "remover acesso" ali
 * sugeriria que existe acesso — e o operador que clicasse ficaria com a impressão
 * de ter revogado algo.
 */
export function canRemoveAccess(item: SourcePendingItem): boolean {
  return item.sourceAccess === 'INVITED' || item.sourceAccess === 'ACTIVE';
}

/**
 * O que a remoção fez, dito **sem prometer o que ela não faz**.
 *
 * A frase nomeia a chamada (convite cancelado × colaborador removido) porque é a
 * distinção que a fatia inteira existe para acertar, e diz explicitamente que o
 * código já clonado permanece. Um "acesso revogado" seco seria lido como "o código
 * voltou" — a mentira que a spec proíbe no §Objetivo.
 */
export function removalOutcomeText(
  outcome: 'invitation_canceled' | 'collaborator_removed' | 'nothing_to_do' | 'failed',
): string {
  if (outcome === 'invitation_canceled') {
    return 'Convite cancelado — o comprador não chegou a entrar no repositório.';
  }
  if (outcome === 'collaborator_removed') {
    return 'Colaborador removido: os updates acabam aqui. O que já foi clonado continua com ele — o mecanismo é contratual.';
  }
  if (outcome === 'nothing_to_do') {
    return 'Não havia acesso a remover.';
  }
  return 'O GitHub recusou a remoção — o acesso CONTINUA de pé. Veja o motivo na pendência.';
}

/**
 * Resumo de uma rodada de reconciliação.
 *
 * Fala de **todas** as licenças, não da que originou o clique: reemitir dispara a
 * rodada do tenant, e dizer "convite reemitido" esconderia que outras também
 * foram. Zero convidados é dito com clareza — é o desfecho mais confuso, porque a
 * ação "funcionou" e nada mudou.
 */
export function reconcileSummary(r: ReconcileResult): string {
  const partes: string[] = [];
  if (r.convidados > 0) partes.push(`${r.convidados} convidado(s)`);
  if (r.aceitos > 0) partes.push(`${r.aceitos} aceito(s)`);
  if (r.falhas > 0) partes.push(`${r.falhas} falha(s)`);
  if (r.aguardandoUsername > 0) partes.push(`${r.aguardandoUsername} sem username`);

  if (partes.length === 0) return 'A rodada não encontrou nada a fazer.';
  return `Rodada concluída: ${partes.join(' · ')}.`;
}

/**
 * Quantas pendências pedem **ação nossa**. É o número que justifica a tela.
 *
 * Conta `failed` e `awaiting_username` — as duas em que alguém aqui dentro tem o
 * que fazer. `invited_not_accepted` fica fora: depende do comprador clicar, e
 * contá-lo faria o contador nunca zerar.
 */
export function actionableCount(itens: SourcePendingItem[]): number {
  return itens.filter((i) => i.reason !== 'invited_not_accepted').length;
}

/**
 * Descreve o estado do PAT pelo **efeito**, não pelo booleano.
 *
 * O PAT fine-grained expira (limite do GitHub), e "configurado" não significa
 * "funciona" — é justamente por isso que existe o teste de conexão. A frase do
 * caso configurado aponta para ele em vez de afirmar que está tudo bem.
 */
export function patStatusText(set: boolean, repo: string | null): string {
  if (!set) {
    return 'Não configurado: nenhum convite ao repositório sai até você salvar um PAT fine-grained aqui.';
  }
  if (!repo) {
    return 'PAT salvo, mas nenhum produto tem repositório de código-fonte configurado — o convite não teria destino.';
  }
  return `PAT salvo para ${repo}. O valor não é exibido. Como PAT fine-grained expira, use o teste de conexão para confirmar que ainda vale.`;
}
