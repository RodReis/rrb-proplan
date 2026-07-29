import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  buildPayload,
  signPayload,
  type LicenseFile,
} from '../domain/license-file';

/**
 * O guardião da chave privada Ed25519 (SPEC-036 §Notas técnicas).
 *
 * **Único ponto do código que toca `LICENSING_SIGNING_KEY`.** Concentrar aqui é
 * o que torna verificável a afirmação *"a privada não sai do servidor"*: uma
 * varredura por essa string tem de achar este arquivo e mais nenhum (o
 * arch-spec do PR-4 é quem afirma isso).
 *
 * ## Ausência é indisponibilidade, não licença sem assinatura
 *
 * Sem a chave configurada, a emissão e o `/activate` **falham** com `503`. A
 * alternativa — devolver um license file sem assinatura, ou assinado com uma
 * chave gerada na hora — produziria arquivos que nenhum cliente valida, e o
 * comprador descobriria isso ao abrir o produto, não aqui. Falhar cedo e alto é
 * o comportamento correto de um segredo ausente.
 *
 * ## Par único, rotação documentada
 *
 * Decisão do PI (§Perguntas 2): o piloto tem **um par** (`kid: "2026-07"`), sem
 * tabela de chaves no banco. O `kid` viaja no license file para que o cliente
 * aceite duas públicas durante a rotação (MVP4 §7) — é o que permite girar a
 * chave depois sem invalidar os arquivos já emitidos. O procedimento fica em
 * `docs/DEPLOY.md`.
 */
@Injectable()
export class LicenseSigningService {
  private readonly logger = new Logger(LicenseSigningService.name);

  /** Está configurado para assinar? A tela usa isto para avisar antes de tentar. */
  get isConfigured(): boolean {
    return Boolean(this.privateKeyPem() && this.kid());
  }

  /**
   * Assina e devolve o license file completo.
   *
   * `signedAt` é o instante desta chamada — é dele que sai a validade offline
   * (`signedAt + graceDays`), e o heartbeat da SPEC-037 renova exatamente este
   * campo emitindo um arquivo novo.
   */
  sign(input: {
    licenseId: string;
    edition: string;
    billingModel: string;
    fingerprint: string;
    issuedAt: Date;
    updatesUntil: Date;
    expiresAt: Date | null;
  }): LicenseFile {
    const chave = this.privateKeyPem();
    const kid = this.kid();

    if (!chave || !kid) {
      // Log com o nome da variável que falta, resposta sem ele: o operador
      // precisa saber o que configurar, quem chama a rota não precisa saber
      // como o servidor guarda segredo.
      this.logger.error(
        'LICENSING_SIGNING_KEY/LICENSING_SIGNING_KID ausente — nenhuma licença pode ser assinada.',
      );
      throw new ServiceUnavailableException(
        'Assinatura de licença indisponível. Contate o suporte.',
      );
    }

    const payload = buildPayload({ ...input, kid });
    return { payload, signature: signPayload(payload, chave) };
  }

  /**
   * PEM da privada. Lido a cada chamada, não no construtor: o servidor precisa
   * pegar a chave nova depois de uma rotação sem exigir redeploy, e ler uma
   * variável de ambiente é barato perto de assinar.
   *
   * **Aceita base64 do PEM ou o PEM direto** — o problema é que PEM tem quebras
   * de linha e secret de Railway (e `.env`) guarda uma linha só. `base64` é o
   * formato preferido, o mesmo que `GITHUB_APP_PRIVATE_KEY` já usa nesta casa;
   * `\n` literal é aceito porque é o outro jeito comum de colar PEM numa linha,
   * e recusá-lo daria "assinatura indisponível" para uma chave que está lá.
   */
  private privateKeyPem(): string | undefined {
    const bruta = process.env.LICENSING_SIGNING_KEY?.trim();
    if (!bruta) return undefined;

    // Já é PEM (com quebras reais ou `\n` escapado): normaliza e devolve.
    if (bruta.includes('-----BEGIN')) return bruta.replace(/\\n/g, '\n');

    // Senão, é base64 do PEM. Decodificação inválida vira `undefined`, que o
    // `sign` traduz em 503 — a mesma resposta de chave ausente, porque uma
    // chave ilegível é uma chave que não existe do ponto de vista da emissão.
    const decodificada = Buffer.from(bruta, 'base64').toString('utf8');
    return decodificada.includes('-----BEGIN') ? decodificada : undefined;
  }

  private kid(): string | undefined {
    return process.env.LICENSING_SIGNING_KID;
  }
}
