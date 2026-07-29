import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashKey } from '../domain/license-key';
import type { LicenseFile } from '../domain/license-file';
import { LicenseSigningService } from './license-signing.service';

/**
 * `POST /licensing/v1/activate` — a ativação de uma máquina (SPEC-036 §Contratos).
 *
 * ## Por que o tenant vem do recurso, e não do request
 *
 * Esta rota **não tem sessão**: quem a chama é o binário na máquina do
 * comprador, que não tem conta no ProPlan. Então ela roda sem
 * `app.tenant_ids`, e o RLS destas tabelas é fail-closed — um `SELECT` direto
 * voltaria vazio para **toda** chave, inclusive as válidas, e cada ativação
 * legítima responderia `404` sem erro no log.
 *
 * A `resolve_license` (SECURITY DEFINER, PR-1) responde *"esta chave existe, e
 * de qual tenant é?"*. Com o tenant em mãos, o resto roda dentro de
 * `runInTenantContext` — o RLS volta a ser quem protege, em vez de um bypass
 * genérico (proibido pelo ADR-020). Mesmo padrão da rota pública do briefing
 * (SPEC-031) e do contrato (SPEC-034).
 *
 * ## O que o cliente recebe
 *
 * Um license file assinado (Ed25519), que ele valida offline com a pública
 * embutida no binário. **O servidor não guarda estado de sessão**: reativar a
 * mesma máquina é idempotente e devolve um arquivo novo, com `signedAt`
 * renovado — que é o que renova a validade offline.
 */

export interface ActivateInput {
  key?: unknown;
  fingerprint?: unknown;
  hostname?: unknown;
  appVersion?: unknown;
}

/** Linha devolvida pela função `resolve_license` (PR-1). */
interface ResolvedLicenseRow {
  id: string;
  tenant_id: string;
  status: string;
  issued_at: Date;
  expires_at: Date | null;
  updates_until: Date;
  max_machines: number;
  edition_slug: string;
  billing_model: string;
}

/** Limites de tamanho: campos livres que vêm de fora, sem sessão. */
const MAX_FINGERPRINT = 128;
const MAX_HOSTNAME = 128;
const MAX_APP_VERSION = 32;

@Injectable()
export class LicenseActivationService {
  private readonly logger = new Logger(LicenseActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: LicenseSigningService,
  ) {}

  async activate(input: ActivateInput): Promise<LicenseFile> {
    const key = texto(input.key);
    const fingerprint = texto(input.fingerprint);

    if (!key || !fingerprint) {
      throw new UnprocessableEntityException('`key` e `fingerprint` são obrigatórios');
    }
    if (fingerprint.length > MAX_FINGERPRINT) {
      throw new UnprocessableEntityException('`fingerprint` longo demais');
    }

    const hostname = texto(input.hostname).slice(0, MAX_HOSTNAME) || null;
    const appVersion = texto(input.appVersion).slice(0, MAX_APP_VERSION) || null;

    const licenca = await this.resolve(key);

    // 404 para chave inexistente. Note que este é o MESMO corpo de resposta que
    // uma chave de outro produto ou malformada recebe: distinguir os casos
    // diria a quem sonda quando ele acertou o formato.
    if (!licenca) throw new NotFoundException('Chave não encontrada');

    // 410 para revogada e para expirada. Os dois são "esta chave existiu e não
    // vale mais", que é exatamente o que 410 significa — e o cliente trata os
    // dois do mesmo jeito (MVP4 §5).
    if (licenca.status === 'REVOKED') {
      throw new GoneException('Licença revogada');
    }
    if (this.expirou(licenca)) {
      throw new GoneException('Licença expirada');
    }

    // Daqui para baixo, tudo sob o contexto do tenant DONO da licença — o RLS
    // volta a valer. Sem isto as escritas abaixo gravariam zero linhas em
    // silêncio (fail-closed), e a ativação "bem-sucedida" não teria acontecido.
    return this.prisma.runInTenantContext([licenca.tenant_id], () =>
      this.registrar(licenca, { fingerprint, hostname, appVersion }),
    );
  }

  /**
   * Cria ou reativa a `Activation` e devolve o arquivo assinado.
   *
   * **A contagem de vagas tem uma corrida conhecida e aceita.** Duas ativações
   * simultâneas de máquinas *diferentes* podem contar as vagas antes de
   * qualquer uma gravar, e as duas passarem — uma terceira máquina entraria
   * numa licença de duas. O unique `(license_id, fingerprint)` do PR-1 fecha o
   * caso da MESMA máquina, que é o comum (retry do cliente, dois cliques); o de
   * máquinas distintas exigiria `SELECT ... FOR UPDATE` na licença.
   *
   * ponytail: contagem sem lock. Ganhar uma vaga extra exige ativar duas
   * máquinas diferentes na mesma fração de segundo, com a mesma chave — e o
   * prejuízo teto é uma máquina a mais numa licença de duas, num modelo cuja
   * premissa declarada é que "a proteção atrasa, não impede" (MVP4 §1). Se
   * aparecer nas métricas de ativação anômala (MVP4 §8), promover para
   * `SELECT 1 FROM licenses WHERE id = ? FOR UPDATE` antes da contagem — o
   * `runInTenantContext` já roda cada operação numa transação, então o lock
   * tem onde viver.
   */
  private async registrar(
    licenca: ResolvedLicenseRow,
    dados: { fingerprint: string; hostname: string | null; appVersion: string | null },
  ): Promise<LicenseFile> {
    const existente = await this.prisma.activation.findUnique({
      where: {
        licenseId_fingerprint: {
          licenseId: licenca.id,
          fingerprint: dados.fingerprint,
        },
      },
    });

    if (existente) {
      // Idempotente: a mesma máquina reativa a linha que já é dela e **não
      // consome vaga**. Reativar uma linha desativada (SPEC-037) é o caminho
      // de volta depois de uma troca de máquina.
      await this.prisma.activation.update({
        where: { id: existente.id },
        data: {
          lastSeenAt: new Date(),
          deactivatedAt: null,
          hostname: dados.hostname ?? existente.hostname,
          appVersion: dados.appVersion ?? existente.appVersion,
        },
      });
      await this.evento(licenca, 'reactivated', { fingerprint: dados.fingerprint });
    } else {
      const vivas = await this.prisma.activation.count({
        where: { licenseId: licenca.id, deactivatedAt: null },
      });

      if (vivas >= licenca.max_machines) {
        // 409 COM a lista de máquinas (§Contratos): sem ela o comprador vê
        // "limite atingido" e não tem como saber qual desativar. A troca
        // self-service é a SPEC-037, mas a informação que a torna possível
        // nasce aqui.
        const ativas = await this.prisma.activation.findMany({
          where: { licenseId: licenca.id, deactivatedAt: null },
          select: { id: true, hostname: true, lastSeenAt: true },
          orderBy: { lastSeenAt: 'desc' },
        });
        throw new ConflictException({
          message: 'Limite de máquinas atingido',
          activations: ativas.map((a) => ({
            id: a.id,
            hostname: a.hostname,
            lastSeenAt: a.lastSeenAt.toISOString(),
          })),
        });
      }

      await this.prisma.activation.create({
        data: {
          tenantId: licenca.tenant_id,
          licenseId: licenca.id,
          fingerprint: dados.fingerprint,
          hostname: dados.hostname,
          appVersion: dados.appVersion,
        },
      });
      await this.evento(licenca, 'activated', {
        fingerprint: dados.fingerprint,
        // `?? undefined`: a chave some do JSON quando não veio, em vez de
        // gravar `null` — a trilha diz "não informado" por ausência.
        hostname: dados.hostname ?? undefined,
      });
    }

    // A assinatura é o último passo: se ela falhar (chave ausente → 503), a
    // ativação já está gravada. É o lado certo de falhar — a vaga consumida
    // com o arquivo faltando se resolve reativando (idempotente), enquanto o
    // inverso entregaria arquivo de uma ativação que não existe.
    return this.signing.sign({
      licenseId: licenca.id,
      edition: licenca.edition_slug,
      billingModel: licenca.billing_model,
      fingerprint: dados.fingerprint,
      issuedAt: licenca.issued_at,
      updatesUntil: licenca.updates_until,
      expiresAt: licenca.expires_at,
    });
  }

  /**
   * Lookup sem contexto de tenant, pela função `SECURITY DEFINER`.
   *
   * `$queryRaw` com parâmetro, nunca concatenação: o hash vem de entrada
   * pública. (É hex de 64 chars por construção, mas a garantia tem de estar na
   * query, não na confiança de que `hashKey` nunca muda.)
   */
  private async resolve(key: string): Promise<ResolvedLicenseRow | null> {
    const linhas = await this.prisma.$queryRaw<ResolvedLicenseRow[]>`
      SELECT * FROM resolve_license(${hashKey(key)})
    `;
    return linhas[0] ?? null;
  }

  /** `expiresAt` no passado. Nulo (PERPETUAL) nunca expira. */
  private expirou(licenca: ResolvedLicenseRow): boolean {
    return Boolean(licenca.expires_at && licenca.expires_at.getTime() <= Date.now());
  }

  private async evento(
    licenca: ResolvedLicenseRow,
    type: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.licEvent.create({
      data: { tenantId: licenca.tenant_id, licenseId: licenca.id, type, payload },
    });
    this.logger.log(`Licença ${licenca.id}: ${type}`);
  }
}

/** `unknown` → string aparada. Entrada de rota pública nunca é confiável. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
