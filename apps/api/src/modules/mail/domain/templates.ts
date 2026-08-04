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
    html: envelope(`Sua chave do ${esc(data.productName)}`, [
      p(`${esc(saudacao)} Sua compra do <strong>${esc(produto)}</strong> foi confirmada.`),

      // ---- A chave: o único conteúdo irrecuperável deste e-mail ----
      // Ela ganha moldura e rótulo próprios porque é o que a pessoa volta aqui
      // para buscar meses depois. Como parágrafo entre outros, ela some na
      // leitura rápida — e o custo de perdê-la é reemissão.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
        ` style="background-color:${COR.realce};border:1px solid ${COR.borda};border-radius:10px;">`,
      `<tr><td style="padding:18px 20px;">`,
      `<div style="font-family:${FONTE_MONO};font-size:10px;letter-spacing:1.4px;` +
        `color:${COR.tintaFosca};line-height:14px;mso-line-height-rule:exactly;">` +
        `CHAVE DE LICENÇA</div>`,
      `<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>`,
      // Monoespaçada e sem quebra: a chave vai ser copiada, e uma quebra no meio
      // faria o comprador colar errado e achar que a chave é inválida.
      `<div style="font-family:${FONTE_MONO};font-size:19px;letter-spacing:1px;` +
        `color:${COR.tintaForte};line-height:28px;mso-line-height-rule:exactly;` +
        `word-break:break-all;">${esc(data.licenseKey)}</div>`,
      `</td></tr></table>`,

      espaco(20),

      // O aviso ganha bloco próprio: em negrito no meio de um parágrafo ele
      // desaparece na leitura rápida, e é o único aviso cuja consequência é
      // irreversível para quem apagar o e-mail.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
        ` style="background-color:${COR.realce};border-radius:10px;">`,
      `<tr><td style="padding:16px 20px;font-family:${FONTE};font-size:14px;` +
        `line-height:23px;mso-line-height-rule:exactly;color:${COR.tinta};">` +
        `<strong>Guarde esta mensagem.</strong> Por segurança, não armazenamos a chave ` +
        `e não conseguimos reenviá-la. Se você perdê-la, precisaremos emitir uma nova.` +
        `</td></tr></table>`,

      espaco(28),

      ...(download
        ? [
            `<div style="font-family:${FONTE};font-size:16px;font-weight:bold;` +
              `color:${COR.tintaForte};line-height:22px;mso-line-height-rule:exactly;">` +
              `Como instalar</div>`,
            espaco(16),
            // Numeração em tabela, não `<ol>`: o recuo padrão da lista varia
            // entre clientes e o Outlook ignora `padding-left`. Aqui a coluna do
            // número tem largura fixa e o alinhamento é o mesmo em todo lugar.
            // A sequência é real (baixar → executar → ativar), não decoração.
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
              ` style="font-family:${FONTE};font-size:14.5px;line-height:23px;` +
              `mso-line-height-rule:exactly;color:${COR.tinta};">`,
            `<tr><td width="26" style="width:26px;vertical-align:top;font-family:${FONTE_MONO};` +
              `font-size:11px;color:${COR.tintaFosca};padding:2px 0 16px;">01</td>`,
            `<td style="padding:0 0 16px;">Baixe o instalador do ${esc(data.productName)}.</td></tr>`,
            `<tr><td style="vertical-align:top;font-family:${FONTE_MONO};font-size:11px;` +
              `color:${COR.tintaFosca};padding:2px 0 16px;">02</td>`,
            // O aviso do SmartScreen antes do passo de ativação, e não num rodapé:
            // ele aparece no meio da instalação, e quem já fechou a janela achando
            // que é vírus não chega ao passo 3.
            `<td style="padding:0 0 16px;">Execute o instalador. O Windows vai exibir um ` +
              `aviso azul do <strong>SmartScreen</strong> ("O Windows protegeu o computador"): ` +
              `clique em <strong>Mais informações</strong> e depois em ` +
              `<strong>Executar assim mesmo</strong>. O aviso aparece porque o instalador ainda ` +
              `não tem assinatura digital paga, não porque haja algo errado com o arquivo.</td></tr>`,
            `<tr><td style="vertical-align:top;font-family:${FONTE_MONO};font-size:11px;` +
              `color:${COR.tintaFosca};padding:2px 0 0;">03</td>`,
            `<td>Abra o ${esc(data.productName)} e cole a chave acima na tela de ativação.</td></tr>`,
            `</table>`,
            espaco(26),
            // Botão em `<td bgcolor>` com o `<a>` preenchendo a célula: cor de
            // fundo em `<a>` não pinta no Outlook, e um botão sem fundo vira
            // texto azul sublinhado no meio do e-mail.
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`,
            `<tr><td bgcolor="${COR.carbono}" style="border-radius:9px;">`,
            // `href` escapado como qualquer outro valor: a URL é configurada pelo
            // operador, mas passa pelo mesmo caminho de um nome vindo da plataforma
            // — e aspas no meio do atributo quebrariam a tag, não o texto.
            `<a href="${esc(download)}" style="display:block;padding:13px 26px;` +
              `font-family:${FONTE};font-size:14.5px;font-weight:bold;color:#ffffff;` +
              `text-decoration:none;border-radius:9px;">Baixar o ${esc(data.productName)}</a>`,
            `</td></tr></table>`,
          ]
        : [p('Para ativar, cole a chave na tela de ativação do aplicativo.')]),

      ...(manual
        ? [
            espaco(26),
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
              ` style="border-top:1px solid #e5e5e1;">`,
            `<tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>`,
            `<tr><td style="font-family:${FONTE};font-size:14px;line-height:23px;` +
              `mso-line-height-rule:exactly;color:${COR.tintaFosca};">` +
              `Guia de uso: <a href="${esc(manual)}" style="color:${COR.tintaForte};">` +
              `Manual do ${esc(data.productName)}</a></td></tr></table>`,
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
    html: envelope(`Licença desativada`, [
      p(`${esc(saudacao)} Sua licença do <strong>${esc(data.productName)}</strong> foi ` +
        `desativada. Motivo: ${esc(data.reason)}.`),
      p('O aplicativo deixará de ativar novas máquinas com esta chave.'),
      // O convite ao contato em bloco destacado: num e-mail que dá má notícia,
      // é a única linha acionável — e chargeback pode ser fraude de terceiro no
      // cartão do próprio comprador, que precisa achar o caminho de volta.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
        ` style="background-color:${COR.realce};border-radius:10px;">`,
      `<tr><td style="padding:16px 20px;font-family:${FONTE};font-size:14px;` +
        `line-height:23px;mso-line-height-rule:exactly;color:${COR.tinta};">` +
        `Se você acredita que isto é um engano, responda a esta mensagem que verificamos.` +
        `</td></tr></table>`,
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
    html: envelope(`Falta um passo para o código-fonte`, [
      p(`${esc(saudacao)} Sua compra do <strong>${esc(produto)}</strong> inclui acesso ao ` +
        `repositório com o código-fonte.`),
      p(`Para liberar esse acesso, precisamos do seu <strong>nome de usuário do GitHub</strong> — ` +
        `é com ele que enviamos o convite ao repositório privado.`),
      espaco(4),
      // Botão em `<td bgcolor>`: fundo em `<a>` não pinta no Outlook, e este
      // e-mail existe para ser clicado — sem clique, nada acontece.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`,
      `<tr><td bgcolor="${COR.carbono}" style="border-radius:9px;">`,
      `<a href="${esc(data.url)}" style="display:block;padding:13px 26px;font-family:${FONTE};` +
        `font-size:14.5px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:9px;">` +
        `Informar meu usuário do GitHub</a>`,
      `</td></tr></table>`,
      espaco(20),
      // A URL em texto, além do botão: cliente que estiliza mal o link deixaria a
      // ação invisível, e este e-mail sem clique não faz nada.
      `<div style="font-family:${FONTE};font-size:13px;line-height:21px;` +
        `mso-line-height-rule:exactly;color:${COR.tintaFosca};">` +
        `Se o botão não funcionar, abra este endereço:<br>` +
        `<a href="${esc(data.url)}" style="color:${COR.tintaForte};word-break:break-all;">` +
        `${esc(data.url)}</a></div>`,
      espaco(20),
      p(`O link funciona uma única vez. Se você ainda não tem conta no GitHub, ` +
        `crie uma em github.com e depois use o link acima.`),
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
    html: envelope(`Convite confirmado para @${esc(data.githubUsername)}`, [
      p(`${esc(saudacao)} Registramos o seu usuário do GitHub para o convite ao ` +
        `repositório do <strong>${esc(data.productName)}</strong>:`),
      // O login em destaque, não no meio do texto: este e-mail é a última chance
      // de pegar um username errado antes que ele vire acesso ao repositório.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
        ` style="background-color:${COR.realce};border:1px solid ${COR.borda};border-radius:10px;">`,
      `<tr><td style="padding:18px 20px;font-family:${FONTE_MONO};font-size:19px;` +
        `color:${COR.tintaForte};line-height:26px;mso-line-height-rule:exactly;` +
        `word-break:break-all;">@${esc(data.githubUsername)}</td></tr></table>`,
      espaco(20),
      p(esc(previsao)),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
        ` style="background-color:${COR.realce};border-radius:10px;">`,
      `<tr><td style="padding:16px 20px;font-family:${FONTE};font-size:14px;` +
        `line-height:23px;mso-line-height-rule:exactly;color:${COR.tinta};">` +
        `<strong>Se esse não é o seu usuário</strong>, responda a esta mensagem agora ` +
        `que corrigimos antes de enviar o convite.</td></tr></table>`,
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
 * Paleta do e-mail — os mesmos valores do tema Carbono (`docs/DESIGN.md` §1),
 * repetidos aqui porque e-mail não lê `tokens.css`: o cliente de e-mail não
 * carrega CSS externo nem entende `var(--token)`.
 *
 * **Repetição consciente, não descuido.** É a única superfície do produto que
 * não pode importar os tokens, e por isso a única onde valor de cor literal é
 * permitido — a regra do CLAUDE.md ("nenhum valor de cor hardcoded em
 * componente") vale para `apps/web`, onde existe token para usar.
 */
const COR = {
  /** Fundo da página, fora do cartão. */
  fundo: '#e9e9e6',
  /** Carbono do header — `--bg` do tema escuro. */
  carbono: '#0e0f12',
  /** Linha divisória dentro do carbono. */
  carbonoBorda: '#1e2025',
  /** Prata: o acento do produto (`--accent`). Não é azul, não é roxo. */
  prata: '#c9ced8',
  /** Texto secundário sobre carbono. */
  prataFosca: '#8b8e96',
  /** Cartão. */
  papel: '#ffffff',
  /** Borda do cartão e das divisórias claras. */
  borda: '#dcdcd8',
  /** Texto principal. Contraste 12.6:1 sobre branco. */
  tinta: '#26282d',
  /** Títulos. */
  tintaForte: '#16171b',
  /** Texto de apoio. Contraste 5.4:1 sobre branco — acima do mínimo AA. */
  tintaFosca: '#5f6268',
  /** Fundo dos blocos de destaque. */
  realce: '#f6f6f4',
  /** Rodapé. */
  rodape: '#fafaf8',
} as const;

const FONTE = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif`;
const FONTE_MONO = `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace`;

/**
 * Casca do HTML: cartão sobre fundo neutro, com header e rodapé do ProPlan.
 *
 * **Tabelas, não `<div>` com flex ou grid.** O Outlook para Windows renderiza
 * e-mail com a engine do Word, que não implementa nem flexbox nem grid nem
 * `max-width`. Tabela aninhada com largura fixa é o que funciona em todo lugar
 * — é por isso que e-mail transacional parece HTML de 2005 mesmo em 2026.
 *
 * **Estilo inline, não `<style>`.** Gmail remove blocos `<style>` do `<head>`,
 * e um e-mail que depende deles chega sem formatação nenhuma no cliente mais
 * usado do mundo. A única exceção é a media query do fim, que degrada sozinha:
 * onde ela é removida, o e-mail continua legível na largura fixa.
 *
 * **Sem imagem nenhuma, de propósito** (decisão do PI, 2026-08-01). O Gmail
 * bloqueia imagem de remetente desconhecido por padrão — e o primeiro e-mail
 * que alguém recebe de nós é justamente este. Um cabeçalho que depende de logo
 * chegaria quebrado na única entrega que não pode falhar. A identidade fica em
 * tipografia, cor e composição, que nenhum cliente bloqueia.
 *
 * @param titulo    Faixa escura sob o header. É o assunto visível ao abrir.
 * @param paragrafos Corpo do cartão, já em HTML.
 */
function envelope(titulo: string, paragrafos: string[]): string {
  return [
    `<!DOCTYPE html><html lang="pt-BR"><head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    // Sem isto o Outlook desktop escala tudo a 120% e a largura de 600px estoura.
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>` +
      `</o:OfficeDocumentSettings></xml><![endif]-->`,
    // A ÚNICA regra fora do inline, e ela é obrigatória: `width="600"` no
    // atributo não cede em tela estreita, e sem isto o cartão fica cortado à
    // direita no celular — onde mais da metade dos e-mails é lida. Degrada
    // sozinha: cliente que remove `<style>` (Gmail) fica com a largura fixa,
    // que é o comportamento de antes; quem a respeita ganha o encaixe.
    `<style>@media only screen and (max-width:620px){`,
    `.envelope{width:100% !important;}`,
    `.px{padding-left:22px !important;padding-right:22px !important;}`,
    `.titulo{font-size:21px !important;line-height:28px !important;}`,
    `}</style>`,
    `</head>`,
    `<body style="margin:0;padding:0;background-color:${COR.fundo};">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
      ` style="background-color:${COR.fundo};"><tr>`,
    `<td align="center" style="padding:30px 12px;">`,
    `<table role="presentation" class="envelope" cellpadding="0" cellspacing="0" border="0"` +
      ` width="600" style="width:600px;max-width:600px;background-color:${COR.papel};` +
      `border:1px solid ${COR.borda};border-radius:16px;overflow:hidden;">`,

    // ---- Header: quem está falando ----
    `<tr><td class="px" style="background-color:${COR.carbono};padding:26px 36px 0;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`,
    // Monograma desenhado em tabela: um quadrado prata com a inicial. Faz o
    // trabalho de um logo sem depender de imagem carregar.
    `<td width="34" style="width:34px;vertical-align:middle;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td width="34" height="34" align="center" bgcolor="${COR.prata}"` +
      ` style="width:34px;height:34px;border-radius:9px;font-family:${FONTE};font-size:16px;` +
      `font-weight:bold;color:${COR.tintaForte};line-height:34px;mso-line-height-rule:exactly;">P</td>`,
    `</tr></table></td>`,
    `<td style="vertical-align:middle;padding-left:12px;font-family:${FONTE};">`,
    `<div style="font-size:15px;font-weight:bold;color:#f5f4f1;line-height:19px;` +
      `mso-line-height-rule:exactly;">ProPlan</div>`,
    `<div style="font-family:${FONTE_MONO};font-size:10px;letter-spacing:1.4px;` +
      `color:${COR.prataFosca};line-height:14px;mso-line-height-rule:exactly;">` +
      `GOVERNANÇA DE PROJETOS</div>`,
    `</td></tr></table></td></tr>`,

    // ---- Faixa do título ----
    `<tr><td class="px" style="background-color:${COR.carbono};padding:22px 36px 26px;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
      ` style="border-top:1px solid ${COR.carbonoBorda};"><tr>`,
    `<td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr><tr>`,
    `<td class="titulo" style="font-family:${FONTE};font-size:24px;line-height:32px;` +
      `mso-line-height-rule:exactly;font-weight:bold;letter-spacing:-0.3px;color:#f5f4f1;">` +
      `${titulo}</td>`,
    `</tr></table></td></tr>`,

    // ---- Corpo ----
    `<tr><td class="px" style="padding:34px 36px 30px;background-color:${COR.papel};` +
      `font-family:${FONTE};font-size:15px;line-height:24px;mso-line-height-rule:exactly;` +
      `color:${COR.tinta};">`,
    ...paragrafos,
    `</td></tr>`,

    // ---- Rodapé: identifica o remetente, sem link morto ----
    // Sem "cancelar recebimento": e-mail transacional não tem o que cancelar —
    // quem comprou não pode descadastrar-se da entrega da própria chave.
    `<tr><td class="px" style="padding:20px 36px 24px;background-color:${COR.rodape};` +
      `border-top:1px solid #e5e5e1;font-family:${FONTE};">`,
    `<div style="font-size:12px;line-height:19px;mso-line-height-rule:exactly;` +
      `color:#8a8d93;">Mensagem automática do ProPlan. Para falar com uma pessoa, ` +
      `basta responder — respostas chegam à nossa caixa.</div>`,
    `<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>`,
    `<div style="font-family:${FONTE_MONO};font-size:10px;letter-spacing:0.6px;` +
      `color:#9a9da1;">RRB TRADING · SÃO PAULO/SP</div>`,
    `</td></tr>`,

    `</table></td></tr></table>`,
    `</body></html>`,
  ].join('');
}

/** Espaçador vertical. Margem em `<div>` é ignorada por vários clientes. */
function espaco(altura: number): string {
  return `<div style="height:${altura}px;line-height:${altura}px;font-size:0;">&nbsp;</div>`;
}

/** Parágrafo do corpo. */
function p(html: string): string {
  return `<p style="margin:0 0 18px;font-family:${FONTE};font-size:15px;line-height:24px;` +
    `mso-line-height-rule:exactly;color:${COR.tinta};">${html}</p>`;
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
