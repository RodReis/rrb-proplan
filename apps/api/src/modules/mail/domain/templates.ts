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
export type TemplateName =
  | 'license_key'
  | 'license_revoked'
  | 'source_username_request'
  | 'source_username_confirmed';

export interface LicenseKeyData {
  /** Nome do comprador. Nulo quando a plataforma não informou. */
  customerName: string | null;
  /** A chave em claro. Existe neste objeto e em nenhum lugar persistido. */
  licenseKey: string;
  /** Nome de exibição do produto ("War Room"). */
  productName: string;
  /** Nome da edição ("Com código-fonte"). */
  editionName: string;
  /**
   * URL pública do instalador, ou `null` quando o produto não a configurou
   * (SPEC-042).
   *
   * `null` **não** é caso de erro: o e-mail sai sem os passos, exatamente como
   * saía antes desta spec. É assim que um produto entregue por outro canal
   * continua funcionando sem ninguém cadastrar nada.
   */
  downloadUrl?: string | null;
  /** URL pública do manual, ou `null` (SPEC-042). */
  manualUrl?: string | null;
}

export interface LicenseRevokedData {
  customerName: string | null;
  productName: string;
  /** Motivo, em linguagem do comprador — nunca o `revokedReason` interno cru. */
  reason: string;
}

export interface SourceUsernameRequestData {
  customerName: string | null;
  productName: string;
  editionName: string;
  /** URL completa da página de coleta, já com o token. Montada por quem envia. */
  url: string;
}

export interface SourceUsernameConfirmedData {
  customerName: string | null;
  productName: string;
  /** O login que será convidado — nomeá-lo é a razão de este e-mail existir. */
  githubUsername: string;
  /** Data prevista do convite (ISO). Nula quando ainda não agendada. */
  inviteAt: string | null;
}

/**
 * A chave da licença — o e-mail que a compra dispara.
 *
 * **A chave aparece aqui e some.** Ela não é persistida (SPEC-036) e o
 * `MailDelivery` guarda só o nome do template, nunca o corpo. É por isso que
 * reenviar este e-mail é impossível: reemitir é o caminho, e ele revoga a
 * anterior.
 *
 * **v2 (SPEC-042): o e-mail entrega a compra, não só a chave.** Antes ele dizia
 * *"cole a chave na tela de ativação"* sem dizer de onde vem o aplicativo — quem
 * comprava dependia da área de membros da plataforma para a primeira instalação.
 * Com `downloadUrl` configurado, o e-mail passa a carregar os três passos.
 *
 * **Os blocos são condicionais, e é o ponto da spec.** Produto sem URL manda o
 * e-mail idêntico ao de antes: nenhum link quebrado, nenhum passo apontando para
 * lugar nenhum, nenhum texto órfão sobre um download que este e-mail não ofereceu.
 */
export function licenseKey(data: LicenseKeyData): RenderedMail {
  const saudacao = data.customerName ? `Olá, ${data.customerName}!` : 'Olá!';
  const produto = `${data.productName} — ${data.editionName}`;
  const download = data.downloadUrl ?? null;
  const manual = data.manualUrl ?? null;

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
      ...(download
        ? [
            'Como instalar:',
            '',
            `1. Baixe o instalador: ${download}`,
            '2. Execute o instalador. O Windows vai exibir um aviso azul do SmartScreen ("O Windows protegeu o computador"): clique em "Mais informações" e depois em "Executar assim mesmo". O aviso aparece porque o instalador ainda não tem assinatura digital paga, não porque haja algo errado com o arquivo.',
            `3. Abra o ${data.productName} e cole a chave acima na tela de ativação.`,
          ]
        : ['Para ativar, cole a chave na tela de ativação do aplicativo.']),
      ...(manual ? ['', `Manual do ${data.productName}: ${manual}`] : []),
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
      ...(download
        ? [
            `<p><strong>Como instalar</strong></p>`,
            `<ol style="padding-left:20px;">`,
            // `href` escapado como qualquer outro valor: a URL é configurada pelo
            // operador, mas passa pelo mesmo caminho de um nome vindo da plataforma
            // — e aspas no meio do atributo quebrariam a tag, não o texto.
            `<li><a href="${esc(download)}">Baixe o instalador</a>.</li>`,
            // O aviso do SmartScreen antes do passo de ativação, e não num rodapé:
            // ele aparece no meio da instalação, e quem já fechou a janela achando
            // que é vírus não chega ao passo 3.
            `<li>Execute o instalador. O Windows vai exibir um aviso azul do ` +
              `<strong>SmartScreen</strong> ("O Windows protegeu o computador"): clique em ` +
              `<strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>. ` +
              `O aviso aparece porque o instalador ainda não tem assinatura digital paga, ` +
              `não porque haja algo errado com o arquivo.</li>`,
            `<li>Abra o ${esc(data.productName)} e cole a chave acima na tela de ativação.</li>`,
            `</ol>`,
          ]
        : [`<p>Para ativar, cole a chave na tela de ativação do aplicativo.</p>`]),
      ...(manual
        ? [
            `<p><a href="${esc(manual)}">Manual do ${esc(data.productName)}</a></p>`,
          ]
        : []),
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

/**
 * Pedido do username do GitHub — o e-mail que a compra da edição source dispara
 * (SPEC-039 §Escopo → Coleta do username).
 *
 * **O link é a mensagem.** Este e-mail existe para levar o comprador a uma página
 * onde ele informa o próprio login; sem clique, nada acontece e ele fica na lista
 * de pendências do admin. Por isso o link aparece duas vezes no HTML (botão e URL
 * em texto) — cliente que bloqueia imagem ou estiliza mal o botão deixaria a
 * ação invisível, e a URL crua é o caminho de volta.
 *
 * **Não promete prazo, porque não há** (decisão PI #3): o link vale até ser
 * usado. Escrever "expira em X dias" seria inventar uma regra que o código não
 * tem — e mandaria o comprador correr sem motivo.
 *
 * **Declara a finalidade** (LGPD, §Notas técnicas): o username do GitHub é dado
 * pessoal, e o texto diz para que ele será usado, em uma frase.
 */
export function sourceUsernameRequest(data: SourceUsernameRequestData): RenderedMail {
  const saudacao = data.customerName ? `Olá, ${data.customerName}!` : 'Olá!';
  const produto = `${data.productName} — ${data.editionName}`;

  return {
    subject: `Falta um passo para liberar o código-fonte do ${data.productName}`,
    text: [
      saudacao,
      '',
      `Sua compra do ${produto} inclui acesso ao repositório com o código-fonte.`,
      '',
      'Para liberar esse acesso, precisamos do seu nome de usuário do GitHub — é com ele que enviamos o convite ao repositório privado.',
      '',
      'Informe o seu usuário nesta página:',
      data.url,
      '',
      'O link funciona uma única vez. Se você ainda não tem conta no GitHub, crie uma em github.com e depois use o link acima.',
    ].join('\n'),
    html: envelope([
      `<p>${esc(saudacao)}</p>`,
      `<p>Sua compra do <strong>${esc(produto)}</strong> inclui acesso ao repositório com o código-fonte.</p>`,
      `<p>Para liberar esse acesso, precisamos do seu <strong>nome de usuário do GitHub</strong> — ` +
        `é com ele que enviamos o convite ao repositório privado.</p>`,
      `<p><a href="${esc(data.url)}" style="display:inline-block;background:#18181b;` +
        `color:#fafafa;padding:12px 20px;border-radius:6px;text-decoration:none;">` +
        `Informar meu usuário do GitHub</a></p>`,
      // A URL em texto, além do botão: cliente que estiliza mal o link deixaria a
      // ação invisível, e este e-mail sem clique não faz nada.
      `<p style="font-size:13px;color:#52525b;">Se o botão não funcionar, abra este endereço:<br>` +
        `<a href="${esc(data.url)}">${esc(data.url)}</a></p>`,
      `<p>O link funciona uma única vez. Se você ainda não tem conta no GitHub, ` +
        `crie uma em github.com e depois use o link acima.</p>`,
    ]),
  };
}

/**
 * Confirmação de quem será convidado (SPEC-039 §Escopo).
 *
 * **Este e-mail é uma das três mitigações do risco aceito**, e a única que age
 * depois do fato: a tela protege contra descuido (confirmação por avatar), o uso
 * único fecha a janela, e este e-mail é o canal por onde o erro volta **antes** de
 * virar acesso. Se o comprador digitou o login de um estranho e confirmou sem
 * olhar, é aqui que ele percebe — enquanto ainda dá tempo.
 *
 * Por isso o login aparece **em destaque**, não no meio de um parágrafo: um
 * username errado escondido no texto corrido não é um aviso, é uma formalidade.
 */
export function sourceUsernameConfirmed(data: SourceUsernameConfirmedData): RenderedMail {
  const saudacao = data.customerName ? `Olá, ${data.customerName}!` : 'Olá!';
  const quando = data.inviteAt ? formatarData(data.inviteAt) : null;
  const previsao = quando
    ? `O convite será enviado em ${quando}.`
    : 'O convite será enviado em breve.';

  return {
    subject: `Confirmado: o convite do ${data.productName} vai para @${data.githubUsername}`,
    text: [
      saudacao,
      '',
      `Registramos o seu usuário do GitHub para o convite ao repositório do ${data.productName}:`,
      '',
      `@${data.githubUsername}`,
      '',
      previsao,
      '',
      // A frase que faz este e-mail valer: sem convite à correção, ele é só um
      // recibo — e recibo não impede que um estranho entre no repositório.
      'Se esse não é o seu usuário, responda a esta mensagem agora que corrigimos antes de enviar o convite.',
    ].join('\n'),
    html: envelope([
      `<p>${esc(saudacao)}</p>`,
      `<p>Registramos o seu usuário do GitHub para o convite ao repositório do ` +
        `<strong>${esc(data.productName)}</strong>:</p>`,
      `<p style="font-family:monospace;font-size:18px;background:#f4f4f5;padding:16px;` +
        `border-radius:6px;">@${esc(data.githubUsername)}</p>`,
      `<p>${esc(previsao)}</p>`,
      `<p><strong>Se esse não é o seu usuário</strong>, responda a esta mensagem agora ` +
        `que corrigimos antes de enviar o convite.</p>`,
    ]),
  };
}

/** Despacha pelo nome — o que o worker tem em mãos ao processar o job. */
export function render(template: TemplateName, data: TemplateData): RenderedMail {
  switch (template) {
    case 'license_key':
      return licenseKey(data as LicenseKeyData);
    case 'license_revoked':
      return licenseRevoked(data as LicenseRevokedData);
    case 'source_username_request':
      return sourceUsernameRequest(data as SourceUsernameRequestData);
    case 'source_username_confirmed':
      return sourceUsernameConfirmed(data as SourceUsernameConfirmedData);
  }
}

/** Dados aceitos pelo `render`, união dos quatro templates. */
export type TemplateData =
  | LicenseKeyData
  | LicenseRevokedData
  | SourceUsernameRequestData
  | SourceUsernameConfirmedData;

/**
 * Data em pt-BR, sem hora. O comprador precisa saber o dia — a hora exata
 * depende de quando o job roda, e prometê-la seria prometer o que não se
 * controla.
 */
function formatarData(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
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
