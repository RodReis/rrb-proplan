import type { OfferMappingView, WebhookEventView } from '../../lib/api';

/**
 * Lógica de apresentação da operação do webhook (SPEC-038, PR-5).
 *
 * Fora do componente pelo motivo de sempre nesta casa: o que decide o que a
 * tela **afirma** deve ser testável sem montar React.
 *
 * O que mais importa aqui é o texto de estado. Esta tela existe para responder
 * *"a venda virou licença?"*, e cada rótulo errado é uma resposta errada a essa
 * pergunta — do tipo que faz alguém reprocessar o que já emitiu, ou ignorar o
 * que ficou parado.
 */

export type WebhookStatus = WebhookEventView['status'];

/** Rótulo em português do status da entrega. */
export function webhookStatusLabel(status: WebhookStatus): string {
  if (status === 'PENDING') return 'Aguardando';
  if (status === 'PROCESSED') return 'Processada';
  if (status === 'FAILED') return 'Falhou';
  // "Descartada" e não "Ignorada": `IGNORED` é a máquina dizendo que o tipo não
  // lhe diz respeito; `DISCARDED` é uma pessoa dizendo que a entrega não vai
  // virar nada. Dois rótulos iguais apagariam a pergunta *quem*.
  if (status === 'DISCARDED') return 'Descartada';
  return 'Ignorada';
}

/**
 * Tom do badge, em três níveis — e a distinção entre eles é a razão da tela.
 *
 * `IGNORED` é **neutro, não alerta**: evento de tipo desconhecido é resultado
 * normal (a plataforma manda `pix_created` e afins), e pintá-lo de vermelho
 * faria o dono caçar problema onde não há. `FAILED` é o único que pede ação.
 */
export function webhookStatusTone(status: WebhookStatus): 'ok' | 'alert' | 'muted' {
  if (status === 'PROCESSED') return 'ok';
  if (status === 'FAILED') return 'alert';
  return 'muted';
}

/**
 * `true` quando reprocessar é oferecido.
 *
 * `PROCESSED` fica de fora porque a idempotência do recebimento não protege o
 * processamento: reprocessar rodaria o job sobre uma venda já emitida. O
 * servidor recusa com `422`, mas oferecer um botão que sempre falha ensina a
 * ignorar erro — então a tela nem o mostra.
 *
 * `IGNORED` **pode** ser reprocessado: se um tipo de evento passar a ser
 * suportado numa versão nova, o que ficou ignorado é exatamente o que se quer
 * reprocessar.
 *
 * `DISCARDED` fica de fora porque **reprocessar não ressuscita** (SPEC-045): o
 * caminho de volta é o *Reabrir*, com carimbo próprio. Dois atos deliberados.
 */
export function canReprocess(evento: WebhookEventView): boolean {
  return evento.status !== 'PROCESSED' && evento.status !== 'DISCARDED';
}

/**
 * `true` quando descartar é oferecido.
 *
 * `PROCESSED` fica de fora: a entrega que virou licença é o elo entre a venda e
 * a chave emitida, e escondê-la quebraria a pergunta *"de onde veio esta
 * licença"*. Ela nem aparece em pendências — não há problema a resolver.
 *
 * `DISCARDED` fica de fora porque já está descartada.
 */
export function canDiscard(evento: WebhookEventView): boolean {
  return evento.status !== 'PROCESSED' && evento.status !== 'DISCARDED';
}

/** `true` só na linha descartada — é o único caminho de volta. */
export function canReopen(evento: WebhookEventView): boolean {
  return evento.status === 'DISCARDED';
}

/**
 * O carimbo do descarte, pronto para a linha: quem, quando e por quê.
 *
 * Devolve `null` fora de entrega descartada. O motivo é o que responde *"por que
 * desistimos"* — e é distinto do `error`, que responde *"por que parou"*.
 */
export function discardNote(evento: WebhookEventView): string | null {
  if (evento.status !== 'DISCARDED' || !evento.discardedAt) return null;
  const autor = evento.discardedBy?.trim();
  const motivo = evento.discardedReason?.trim() || 'sem motivo registrado';
  return autor ? `${motivo} — descartada por ${autor}` : motivo;
}

/**
 * O que o dono precisa ler numa entrega que falhou.
 *
 * Devolve a mensagem do servidor quando existe. O fallback não é genérico de
 * propósito: *"falhou sem mensagem"* é uma informação real (e um defeito nosso,
 * porque o PR-3 deveria gravar o motivo), enquanto *"erro desconhecido"* soaria
 * como estado normal.
 */
export function webhookErrorText(evento: WebhookEventView): string | null {
  if (evento.status !== 'FAILED') return null;
  return evento.error?.trim() || 'Falhou sem mensagem registrada';
}

/**
 * Rótulo do alvo do mapeamento. Curinga (`externalOfferId` nulo) é dito por
 * extenso — `—` deixaria o caso mais importante parecendo campo em branco, e é
 * justamente o que resolve "qualquer oferta deste produto".
 */
export function offerLabel(mapeamento: OfferMappingView): string {
  return mapeamento.externalOfferId ?? 'qualquer oferta (curinga)';
}

/**
 * Descreve o efeito da tolerância em vez do número solto.
 *
 * `null` **não** é "0 dias" nem campo vazio: é a decisão PI #3 — o ProPlan não
 * corta e quem revoga é a plataforma. A frase diz isso, porque um `—` na tela
 * seria lido como "não configurado" e alguém iria "consertar" configurando.
 */
export function toleranceLabel(days: number | null): string {
  if (days === null) return 'O ProPlan nunca corta por atraso — só a plataforma revoga';
  if (days === 0) return 'Corta assim que a plataforma avisa o atraso';
  return `Corta ${days} ${days === 1 ? 'dia' : 'dias'} depois do aviso de atraso`;
}

/**
 * Quantas entregas pedem ação. É o número que justifica a tela existir — e
 * conta só `FAILED`, porque `PENDING` está no caminho normal (o job vai pegar).
 */
export function pendingCount(eventos: WebhookEventView[]): number {
  return eventos.filter((e) => e.status === 'FAILED').length;
}

/**
 * O id do produto dentro da mensagem de falha, quando a causa é oferta sem par.
 *
 * O servidor grava `Oferta sem mapeamento: produto <id>, oferta <id|(nenhuma)>`
 * — e **esse era o único lugar onde o operador via o id**, para transcrevê-lo à
 * mão noutra aba. Extrair aqui é o que permite oferecer o mapeamento na própria
 * linha que falhou (FIX do dogfooding, 2026-07-31).
 *
 * Devolve `null` para qualquer outro erro: licença não encontrada, assinatura
 * inválida e o resto não têm o que mapear, e oferecer o seletor ali sugeriria
 * que o problema é de-para quando não é.
 */
export function produtoDoErro(erro: string | null): string | null {
  if (!erro) return null;
  const m = /Oferta sem mapeamento: produto ([^\s,]+)/.exec(erro);
  return m ? m[1] : null;
}
