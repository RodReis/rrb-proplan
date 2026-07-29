/**
 * Os templates transacionais (SPEC-038 §Escopo → Módulo `mail`).
 *
 * **Funções puras, sem engine de template.** Nada de Handlebars, MJML ou
 * `@react-email`: são dois e-mails, e uma dependência nova para interpolar
 * quatro variáveis se paga em manutenção, não em valor. Quando o terceiro
 * template chegar com layout compartilhado, a hora de trocar é essa.
 *
 * **Cada template devolve `subject` + `html` + `text`.** O `text` não é
 * cortesia: cliente que bloqueia HTML por padrão mostraria uma mensagem vazia,
 * e filtro de spam pontua pior mensagem só-HTML — num e-mail cuja função é
 * entregar a chave que o cliente pagou, cair na caixa de spam é o pior desfecho
 * possível.
 *
 * **A interpolação escapa HTML.** Nome do comprador vem da plataforma de
 * pagamento, que é entrada externa; sem escapar, um nome com `<script>` viaja
 * dentro do nosso e-mail. Custa uma função de cinco linhas.
 */

/** O que um template produz. Não inclui o destinatário — quem envia decide. */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** Nomes dos templates. É o valor gravado em `MailDelivery.template`. */
export type TemplateName = 'license_key' | 'license_revoked';

export interface LicenseKeyData {
  /** Nome do comprador. Nulo quando a plataforma não informou. */
  customerName: string | null;
  /** A chave em claro. Existe neste objeto e em nenhum lugar persistido. */
  licenseKey: string;
  /** Nome de exibição do produto ("War Room"). */
  productName: string;
  /** Nome da edição ("Com código-fonte"). */
  editionName: string;
}

export interface LicenseRevokedData {
  customerName: string | null;
  productName: string;
  /** Motivo, em linguagem do comprador — nunca o `revokedReason` interno cru. */
  reason: string;
}

/**
 * A chave da licença — o e-mail que a compra dispara.
 *
 * **A chave aparece aqui e some.** Ela não é persistida (SPEC-036) e o
 * `MailDelivery` guarda só o nome do template, nunca o corpo. É por isso que
 * reenviar este e-mail é impossível: reemitir é o caminho, e ele revoga a
 * anterior.
 */
export function licenseKey(data: LicenseKeyData): RenderedMail {
  const saudacao = data.customerName ? `Olá, ${data.customerName}!` : 'Olá!';
  const produto = `${data.productName} — ${data.editionName}`;

  return {
    subject: `Sua chave do ${data.productName}`,
    text: [
      saudacao,
      '',
      `Sua compra do ${produto} foi confirmada. Esta é a sua chave de licença:`,
      '',
      data.licenseKey,
      '',
      // Frase inteira numa linha só: quebrar no meio deixa o texto torto em
      // cliente que não reflui parágrafo — e esta é a frase que evita o chamado
      // de suporte de quem apagou o e-mail sem copiar a chave.
      'Guarde esta mensagem: por segurança, não armazenamos a chave e não conseguimos reenviá-la. Se você perdê-la, precisaremos emitir uma nova.',
      '',
      'Para ativar, cole a chave na tela de ativação do aplicativo.',
    ].join('\n'),
    html: envelope([
      `<p>${esc(saudacao)}</p>`,
      `<p>Sua compra do <strong>${esc(produto)}</strong> foi confirmada. Esta é a sua chave de licença:</p>`,
      // A chave em bloco monoespaçado e selecionável: ela vai ser copiada e
      // colada, e quebra de linha no meio faria o comprador colar errado.
      `<p style="font-family:monospace;font-size:18px;letter-spacing:1px;` +
        `background:#f4f4f5;padding:16px;border-radius:6px;">${esc(data.licenseKey)}</p>`,
      `<p><strong>Guarde esta mensagem.</strong> Por segurança, não armazenamos a ` +
        `chave e não conseguimos reenviá-la. Se você perdê-la, precisaremos emitir uma nova.</p>`,
      `<p>Para ativar, cole a chave na tela de ativação do aplicativo.</p>`,
    ]),
  };
}

/**
 * Aviso de revogação — reembolso ou chargeback.
 *
 * **Diz o que aconteceu sem acusar.** Chargeback pode ser fraude de terceiro no
 * cartão do próprio comprador, e um e-mail que trata o cliente como caloteiro
 * erra em cima de quem já foi vítima. O texto informa e abre caminho de contato.
 */
export function licenseRevoked(data: LicenseRevokedData): RenderedMail {
  const saudacao = data.customerName ? `Olá, ${data.customerName}!` : 'Olá!';

  return {
    subject: `Sua licença do ${data.productName} foi desativada`,
    text: [
      saudacao,
      '',
      `Sua licença do ${data.productName} foi desativada. Motivo: ${data.reason}.`,
      '',
      'O aplicativo deixará de ativar novas máquinas com esta chave.',
      '',
      'Se você acredita que isto é um engano, responda a esta mensagem que verificamos.',
    ].join('\n'),
    html: envelope([
      `<p>${esc(saudacao)}</p>`,
      `<p>Sua licença do <strong>${esc(data.productName)}</strong> foi desativada. ` +
        `Motivo: ${esc(data.reason)}.</p>`,
      `<p>O aplicativo deixará de ativar novas máquinas com esta chave.</p>`,
      `<p>Se você acredita que isto é um engano, responda a esta mensagem que verificamos.</p>`,
    ]),
  };
}

/** Despacha pelo nome — o que o worker tem em mãos ao processar o job. */
export function render(
  template: TemplateName,
  data: LicenseKeyData | LicenseRevokedData,
): RenderedMail {
  if (template === 'license_key') return licenseKey(data as LicenseKeyData);
  return licenseRevoked(data as LicenseRevokedData);
}

/**
 * Casca do HTML: largura legível e fonte de sistema.
 *
 * **Estilo inline, não `<style>`.** Gmail remove blocos `<style>` do `<head>`,
 * e um e-mail que depende deles chega sem formatação nenhuma no cliente mais
 * usado do mundo. É a razão de todo e-mail transacional parecer HTML de 2005.
 */
function envelope(paragrafos: string[]): string {
  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;` +
      `font-size:15px;line-height:1.6;color:#18181b;max-width:560px;">`,
    ...paragrafos,
    `</div>`,
  ].join('');
}

/**
 * Escapa HTML. O nome do comprador vem da plataforma de pagamento — entrada
 * externa, e sem isto um nome com `<script>` viaja dentro do nosso e-mail.
 */
function esc(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
