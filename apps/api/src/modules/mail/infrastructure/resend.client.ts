import { Injectable, Logger } from '@nestjs/common';

/**
 * Adapter do Resend (SPEC-038 §Escopo → Módulo `mail`).
 *
 * **`fetch` na REST API, sem SDK.** Mesma decisão do GitHub (CLAUDE.md: Octokit
 * é ESM-only e conflita com o build CJS do Nest). São ~40 linhas contra uma
 * dependência nova no caminho de um build que já pagou esse preço uma vez.
 *
 * **`User-Agent` é obrigatório, e a falta dele não diz o que é.** Requisições
 * sem esse header são bloqueadas antes de chegar à API, com `403` e código
 * `1010` — e a mensagem não menciona o header. `curl` manda sozinho, `fetch`
 * não; é exatamente a classe de erro que só aparece em produção e leva uma
 * tarde para achar.
 *
 * **A interface é a fronteira.** `MailService` depende deste tipo, não do
 * Resend: trocar de provedor é escrever outro `MailProvider`.
 */

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  /** Id do provedor, para rastrear no painel dele. */
  providerMessageId: string;
}

/** O que o `MailService` conhece. O Resend é uma implementação, não o contrato. */
export abstract class MailProvider {
  abstract send(input: SendMailInput): Promise<SendMailResult>;
}

const ENDPOINT = 'https://api.resend.com/emails';
/** Rede lenta não pode segurar um worker: o BullMQ retenta. */
const TIMEOUT_MS = 15_000;

@Injectable()
export class ResendClient extends MailProvider {
  private readonly logger = new Logger(ResendClient.name);

  /**
   * Envia e devolve o id do provedor.
   *
   * **Lança em qualquer falha, de propósito.** Quem chama é o worker, e é o
   * `throw` que faz o BullMQ contabilizar a tentativa e reagendar com backoff.
   * Devolver um resultado de erro aqui exigiria que todo chamador se lembrasse
   * de relançar — e o que esquecesse marcaria como enviado um e-mail que não
   * saiu.
   */
  async send(input: SendMailInput): Promise<SendMailResult> {
    const apiKey = process.env.RESEND_API_KEY ?? '';
    const from = process.env.MAIL_FROM ?? '';

    // Falta de configuração falha ANTES da rede, com o nome da variável na
    // mensagem. Sem isto, a chamada sairia com `Bearer ` vazio e voltaria um
    // `401` genérico do provedor — mesma falha, mensagem que não ensina nada.
    if (!apiKey) throw new Error('RESEND_API_KEY ausente — nenhum e-mail pode ser enviado');
    if (!from) throw new Error('MAIL_FROM ausente — nenhum e-mail pode ser enviado');

    const resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Ver o bloco acima: sem isto, `403` código 1010 antes de chegar à API.
        'User-Agent': 'rrb-proplan/1.0',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok) {
      // O corpo do erro do Resend traz `message`; ele vai para `MailDelivery.error`
      // e é o que o admin lê. Um "falhou" sem o motivo do provedor deixaria
      // "domínio não verificado" indistinguível de "chave inválida".
      const detalhe = await resposta.text().catch(() => '');
      throw new Error(`Resend respondeu ${resposta.status}: ${detalhe.slice(0, 300)}`);
    }

    const corpo = (await resposta.json()) as { id?: string };
    if (!corpo.id) {
      // `200` sem id é resposta que não podemos rastrear. Tratar como sucesso
      // gravaria `SENT` sem `providerMessageId`, e a pergunta "o que aconteceu
      // com este e-mail?" ficaria sem resposta no painel do provedor.
      throw new Error('Resend respondeu 200 sem `id` — envio não rastreável');
    }

    // Sem o destinatário no log: e-mail de comprador é dado pessoal, e o
    // `MailDelivery` já o guarda no lugar certo, sob RLS.
    this.logger.log(`E-mail enviado (${corpo.id})`);
    return { providerMessageId: corpo.id };
  }
}
