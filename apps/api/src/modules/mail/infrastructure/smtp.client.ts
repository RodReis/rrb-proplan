import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { MailProvider, type SendMailInput, type SendMailResult } from './resend.client';

/**
 * Adapter SMTP (caixa da Hostinger).
 *
 * ## Por que existe, se a SPEC-038 escolheu o Resend
 *
 * A **decisão PI #4** da SPEC-038 (§Notas técnicas) escolheu subdomínio dedicado
 * de envio via Resend, para isolar a reputação do transacional do domínio
 * principal. O pressuposto dela caiu na operação: o plano gratuito do Resend
 * verifica **um** domínio, o da conta já está em uso por outro produto, e
 * acrescentar `rrbtrading.com.br` custa US$20/mês. **Decisão do PI (2026-08-04):
 * usar a caixa SMTP da Hostinger, já paga e já configurada no Railway.**
 *
 * O que se perde é real e vale dizer: a reputação do transacional passa a
 * compartilhar o domínio principal, e caixa comum tem limite diário (na ordem de
 * centenas). Para o volume do piloto, nenhum dos dois morde — mas os dois voltam
 * a morder se o volume crescer, e é aí que a decisão #4 merece ser relida.
 *
 * ## `nodemailer` e não `fetch`
 *
 * O `ResendClient` fala HTTP e por isso dispensa SDK (CLAUDE.md: Octokit é
 * ESM-only e conflita com o build CJS do Nest — o mesmo cuidado se aplica).
 * SMTP não é HTTP: são TLS, AUTH, e encoding MIME de cabeçalho e corpo. Escrever
 * isso à mão para "evitar uma dependência" trocaria 60 linhas por um protocolo
 * inteiro, e o primeiro assunto com acento chegaria corrompido.
 *
 * ## O transporter é criado uma vez
 *
 * `createTransport` mantém pool de conexões. Criar um por envio abriria e
 * derrubaria uma conexão TLS a cada e-mail — e o handshake é a parte cara.
 * Criado sob demanda (não no construtor) porque as variáveis são lidas no envio:
 * é o que mantém a mensagem de erro de configuração útil, igual à do Resend.
 */

/** Porta 465 é TLS implícito; 587 é STARTTLS. A diferença muda o handshake. */
const PORTA_TLS_IMPLICITO = 465;
/** Rede lenta não pode segurar um worker: o BullMQ retenta. */
const TIMEOUT_MS = 15_000;

@Injectable()
export class SmtpClient extends MailProvider {
  private readonly logger = new Logger(SmtpClient.name);
  private transporter: Transporter | null = null;

  /**
   * Envia e devolve o `messageId` do servidor.
   *
   * **Lança em qualquer falha, de propósito** — mesma decisão do `ResendClient`:
   * é o `throw` que faz o BullMQ contabilizar a tentativa e reagendar com
   * backoff. Devolver erro como valor exigiria que todo chamador se lembrasse de
   * relançar, e o que esquecesse marcaria como enviado um e-mail que não saiu.
   */
  async send(input: SendMailInput): Promise<SendMailResult> {
    const host = process.env.SMTP_HOST ?? '';
    const user = process.env.SMTP_USER ?? '';
    const pass = process.env.SMTP_PASS ?? '';
    // `SMTP_FROM` primeiro, `MAIL_FROM` como fallback: a segunda já existia para
    // o Resend, e exigir a nova em ambiente que já funcionava quebraria o envio
    // por uma renomeação.
    const from = process.env.SMTP_FROM || process.env.MAIL_FROM || '';

    // Falta de configuração falha ANTES da rede, com o nome da variável na
    // mensagem. Sem isto, o erro seria um timeout ou um "authentication failed"
    // genérico — mesma falha, mensagem que não ensina nada.
    if (!host) throw new Error('SMTP_HOST ausente — nenhum e-mail pode ser enviado');
    if (!user) throw new Error('SMTP_USER ausente — nenhum e-mail pode ser enviado');
    if (!pass) throw new Error('SMTP_PASS ausente — nenhum e-mail pode ser enviado');
    if (!from) throw new Error('SMTP_FROM (ou MAIL_FROM) ausente — nenhum e-mail pode ser enviado');

    const porta = Number(process.env.SMTP_PORT ?? PORTA_TLS_IMPLICITO);
    // `secure` derivado da porta quando a env não diz, porque errar isso trava o
    // handshake sem mensagem clara: 465 exige TLS implícito, 587 exige STARTTLS.
    const secure = process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : porta === PORTA_TLS_IMPLICITO;

    const transporter = this.obterTransporter({ host, porta, secure, user, pass });

    const info = await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      // O `text` junto do `html`: cliente que bloqueia HTML mostraria mensagem
      // vazia, e filtro de spam pontua pior mensagem só-HTML — num e-mail que
      // entrega o que o cliente pagou, cair no spam é o pior desfecho.
      text: input.text,
    });

    if (!info.messageId) {
      // Envio sem id não é rastreável. Tratar como sucesso gravaria `SENT` sem
      // `providerMessageId`, e "o que aconteceu com este e-mail?" ficaria sem
      // resposta — mesmo argumento do `ResendClient`.
      throw new Error('SMTP aceitou sem `messageId` — envio não rastreável');
    }

    // Sem o destinatário no log: e-mail de comprador é dado pessoal, e a
    // `MailDelivery` já o guarda no lugar certo, sob RLS.
    this.logger.log(`E-mail enviado (${info.messageId})`);
    return { providerMessageId: info.messageId };
  }

  private obterTransporter(config: {
    host: string;
    porta: number;
    secure: boolean;
    user: string;
    pass: string;
  }): Transporter {
    if (this.transporter) return this.transporter;

    this.transporter = createTransport({
      host: config.host,
      port: config.porta,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });

    return this.transporter;
  }
}
