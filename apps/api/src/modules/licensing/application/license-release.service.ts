import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  latestAuthorized,
  latestOverall,
} from '../domain/release-authorization';
import { LicenseActivationService } from './license-activation.service';

/**
 * `POST /licensing/v1/releases/check` (SPEC-041 §Contratos) — *"há versão nova
 * para mim?"*.
 *
 * ## Barata e idempotente, ao contrário do `download`
 *
 * São duas rotas justamente por isso (§Notas técnicas): esta responde sem falar
 * com o GitHub e pode ser chamada à vontade; a do PR-3 cunha URL assinada de vida
 * curta a cada chamada, e por isso não pode ser cacheada. Fundi-las obrigaria a
 * pedir URL nova só para perguntar se há update — e a URL expiraria antes de o
 * usuário clicar em "atualizar".
 *
 * ## Não escreve nada
 *
 * Nenhum `lastSeenAt`, nenhum `LicEvent`. Perguntar se há atualização não é sinal
 * de vida (o `heartbeat` é quem governa isso) e não é download (o `LicEvent` de
 * auditoria nasce no PR-3, quando o cliente de fato leva o binário). Registrar
 * aqui encheria a trilha de linhas de "perguntou" e afogaria as de "baixou", que
 * são as que respondem *quem levou o quê*.
 */

export interface ReleaseCheckInput {
  licenseKey?: unknown;
  fingerprint?: unknown;
  /** O que o cliente tem instalado hoje. Opcional — ver `update: false`. */
  currentVersion?: unknown;
}

export type ReleaseCheckResult =
  | { update: false }
  | {
      update: true;
      version: string;
      releasedAt: string;
      sha256: string;
      notes: string | null;
      /**
       * `current` — é a release mais nova que existe.
       * `last-authorized` — há mais nova, fora da janela de updates desta licença.
       *
       * O cliente precisa da distinção para oferecer renovação sem mentir: sem
       * ela, "você está atualizado" sairia para quem na verdade parou de receber
       * versões.
       */
      reason: 'current' | 'last-authorized';
    };

/** Campo livre vindo de fora, sem sessão. */
const MAX_FINGERPRINT = 128;
const MAX_VERSION = 64;

@Injectable()
export class LicenseReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activation: LicenseActivationService,
  ) {}

  async check(input: ReleaseCheckInput): Promise<ReleaseCheckResult> {
    const licenseKey = texto(input.licenseKey);
    const fingerprint = texto(input.fingerprint);

    if (!licenseKey || !fingerprint) {
      throw new UnprocessableEntityException(
        '`licenseKey` e `fingerprint` são obrigatórios',
      );
    }
    if (fingerprint.length > MAX_FINGERPRINT) {
      throw new UnprocessableEntityException('`fingerprint` longo demais');
    }

    const currentVersion = texto(input.currentVersion).slice(0, MAX_VERSION);

    // O gate compartilhado: `404` chave inexistente, `410` revogada/expirada/
    // inadimplente, `409` fingerprint não ativo. Vem do serviço de ativação de
    // propósito — é o mesmo gate do `/heartbeat`, não uma segunda opinião.
    const licenca = await this.activation.licencaParaUpdate(licenseKey, fingerprint);

    return this.prisma.runInTenantContext([licenca.tenant_id], async () => {
      const releases = await this.prisma.licRelease.findMany({
        where: {
          productId: licenca.product_id,
          // **Despublicada some do `check` E do `download`** (§Critérios de
          // aceite). Filtrar aqui, e não na decisão, é o que garante que ela nem
          // participe da escolha do "mais novo": uma release retirada por defeito
          // não pode virar a resposta nem sequer como `last-authorized`.
          published: true,
        },
        select: {
          version: true,
          releasedAt: true,
          sha256: true,
          notes: true,
        },
      });

      const autorizada = latestAuthorized(releases, licenca.updates_until);

      // Nenhuma release autorizada: nem a mais antiga cabe na janela desta
      // licença. `update: false` é a resposta honesta — não há o que oferecer.
      if (!autorizada) return { update: false };

      // O cliente já está na versão autorizada mais nova. Comparação por
      // igualdade de string, não por semver: `version` é o identificador que o
      // admin registrou e que o instalador carrega — inventar ordenação semver
      // aqui criaria uma segunda noção de "mais novo", divergente do
      // `releasedAt` que a autorização usa.
      if (currentVersion && currentVersion === autorizada.version) {
        return { update: false };
      }

      const maisNovaQueExiste = latestOverall(releases);

      return {
        update: true,
        version: autorizada.version,
        releasedAt: autorizada.releasedAt.toISOString(),
        sha256: autorizada.sha256,
        notes: autorizada.notes,
        reason:
          maisNovaQueExiste && maisNovaQueExiste.version !== autorizada.version
            ? 'last-authorized'
            : 'current',
      };
    });
  }
}

/** Normaliza entrada não-confiável: só string vira texto, o resto vira vazio. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
