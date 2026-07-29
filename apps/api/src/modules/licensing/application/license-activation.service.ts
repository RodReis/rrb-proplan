import {
  BadRequestException,
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

export interface HeartbeatInput {
  key?: unknown;
  fingerprint?: unknown;
  appVersion?: unknown;
}

export interface DeactivateInput {
  key?: unknown;
  /** A própria máquina. Exclusivo com `activationId`. */
  fingerprint?: unknown;
  /** Outra máquina, pelo id da lista do `409`. Exclusivo com `fingerprint`. */
  activationId?: unknown;
}

export interface DeactivateResult {
  deactivated: true;
  /** Vagas livres depois desta desativação — o cliente sabe se já pode ativar. */
  remainingSlots: number;
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

    const licenca = await this.licencaUtilizavel(key);

    // Daqui para baixo, tudo sob o contexto do tenant DONO da licença — o RLS
    // volta a valer. Sem isto as escritas abaixo gravariam zero linhas em
    // silêncio (fail-closed), e a ativação "bem-sucedida" não teria acontecido.
    return this.prisma.runInTenantContext([licenca.tenant_id], () =>
      this.registrar(licenca, { fingerprint, hostname, appVersion }),
    );
  }

  /**
   * `POST /licensing/v1/heartbeat` (SPEC-037) — a máquina diz "ainda estou
   * aqui" e recebe um license file **reassinado**.
   *
   * O que ele renova é o `signedAt`, e é sobre ele que o cliente mede a graça
   * de 14 dias: sem heartbeat, a máquina cai em graça e depois em degradado
   * sozinha. Não é o servidor que desliga o produto — é o arquivo que envelhece.
   *
   * **Não reativa em silêncio, e essa é a decisão de desenho da fatia.** Se o
   * fingerprint não está ativo, houve desativação deliberada (troca de máquina)
   * ou uma máquina nova reusando a chave. Reativar sozinho aqui tornaria o
   * `maxMachines` decorativo — bastaria não chamar `/activate`. O `409` devolve
   * a lista e quem decide é o cliente.
   */
  async heartbeat(input: HeartbeatInput): Promise<LicenseFile> {
    const key = texto(input.key);
    const fingerprint = texto(input.fingerprint);

    if (!key || !fingerprint) {
      throw new UnprocessableEntityException('`key` e `fingerprint` são obrigatórios');
    }

    const appVersion = texto(input.appVersion).slice(0, MAX_APP_VERSION) || null;
    const licenca = await this.licencaUtilizavel(key);

    return this.prisma.runInTenantContext([licenca.tenant_id], async () => {
      const ativacao = await this.prisma.activation.findUnique({
        where: {
          licenseId_fingerprint: { licenseId: licenca.id, fingerprint },
        },
      });

      if (!ativacao || ativacao.deactivatedAt !== null) {
        throw await this.conflitoDeMaquinas(licenca);
      }

      await this.prisma.activation.update({
        where: { id: ativacao.id },
        data: {
          lastSeenAt: new Date(),
          // Só sobrescreve quando veio: um cliente que não informa a versão não
          // deve apagar a última conhecida.
          appVersion: appVersion ?? ativacao.appVersion,
        },
      });
      await this.evento(licenca, 'heartbeat', { fingerprint });

      return this.assinar(licenca, fingerprint);
    });
  }

  /**
   * `POST /licensing/v1/deactivate` (SPEC-037) — libera uma vaga.
   *
   * Duas formas, ambas autenticadas pela própria chave: **a própria máquina**
   * (`fingerprint`) e **outra máquina** (`activationId`, obtido na lista do
   * `409`). A segunda é o que torna a troca possível quando o computador antigo
   * não está mais acessível — que é o caso comum de quem trocou de máquina.
   *
   * **Soft delete:** `deactivatedAt` preenchido, linha preservada. Apagar
   * esconderia a troca do suporte e zeraria o contador de trocas, que é o sinal
   * de abuso do §Escopo.
   */
  async deactivate(input: DeactivateInput): Promise<DeactivateResult> {
    const key = texto(input.key);
    const fingerprint = texto(input.fingerprint);
    const activationId = texto(input.activationId);

    if (!key) {
      throw new UnprocessableEntityException('`key` é obrigatório');
    }
    // Exatamente um dos dois (§Contratos). Aceitar ambos exigiria decidir qual
    // vence quando apontam para máquinas diferentes — e qualquer escolha
    // desativaria em silêncio uma máquina que o cliente não pediu.
    if (Boolean(fingerprint) === Boolean(activationId)) {
      throw new BadRequestException(
        'Informe `fingerprint` OU `activationId`, nunca os dois',
      );
    }

    const licenca = await this.resolve(key);
    if (!licenca) throw new NotFoundException('Chave não encontrada');
    // Revogada não desativa: não há vaga a liberar numa licença que já não
    // ativa nada. Expirada NÃO é bloqueada — quem deixou a assinatura vencer
    // ainda pode querer liberar a máquina antes de renovar.
    if (licenca.status === 'REVOKED') throw new GoneException('Licença revogada');

    return this.prisma.runInTenantContext([licenca.tenant_id], async () => {
      const ativacao = activationId
        ? // `licenseId` no where junto do id: "existe mas é de outra licença"
          // responde o MESMO que "não existe" (§Notas técnicas) — é o que
          // impede enumerar ativações alheias com ids adivinhados.
          await this.prisma.activation.findFirst({
            where: { id: activationId, licenseId: licenca.id },
          })
        : await this.prisma.activation.findUnique({
            where: {
              licenseId_fingerprint: { licenseId: licenca.id, fingerprint },
            },
          });

      if (!ativacao) throw new NotFoundException('Ativação não encontrada');

      // Idempotente: já desativada devolve `200` **sem novo evento**. O evento
      // duplicado inflaria o contador de trocas e faria o sinal de abuso
      // disparar por retry de rede (§Notas técnicas).
      if (ativacao.deactivatedAt === null) {
        await this.prisma.activation.update({
          where: { id: ativacao.id },
          data: { deactivatedAt: new Date() },
        });
        await this.evento(licenca, 'deactivated', {
          fingerprint: ativacao.fingerprint,
        });
      }

      const vivas = await this.prisma.activation.count({
        where: { licenseId: licenca.id, deactivatedAt: null },
      });

      return {
        deactivated: true,
        remainingSlots: Math.max(0, licenca.max_machines - vivas),
      };
    });
  }

  /**
   * Resolve a chave e aplica o gate de status — os três códigos que as rotas
   * públicas compartilham.
   *
   * Extraído porque `activate` e `heartbeat` precisam **exatamente** do mesmo
   * gate: uma cópia divergindo (um checando `expiresAt`, o outro não) deixaria
   * uma das rotas servindo licença vencida.
   */
  private async licencaUtilizavel(key: string): Promise<ResolvedLicenseRow> {
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

    return licenca;
  }

  /**
   * O `409` com a lista de máquinas vivas — mesma forma no `/activate` (limite
   * atingido) e no `/heartbeat` (fingerprint não ativo).
   *
   * A lista é o que torna a troca self-service possível: sem ela o cliente vê o
   * erro e não tem como saber qual `activationId` mandar para o `/deactivate`.
   */
  private async conflitoDeMaquinas(
    licenca: ResolvedLicenseRow,
  ): Promise<ConflictException> {
    const ativas = await this.prisma.activation.findMany({
      where: { licenseId: licenca.id, deactivatedAt: null },
      select: { id: true, hostname: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return new ConflictException({
      message: 'Limite de máquinas atingido',
      activations: ativas.map((a) => ({
        id: a.id,
        hostname: a.hostname,
        lastSeenAt: a.lastSeenAt.toISOString(),
      })),
    });
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

    // Linha VIVA da mesma máquina: reativa sem consumir vaga, porque ela já
    // ocupa uma. É o retry do cliente e os dois cliques do comprador.
    if (existente && existente.deactivatedAt === null) {
      await this.prisma.activation.update({
        where: { id: existente.id },
        data: {
          lastSeenAt: new Date(),
          hostname: dados.hostname ?? existente.hostname,
          appVersion: dados.appVersion ?? existente.appVersion,
        },
      });
      await this.evento(licenca, 'reactivated', { fingerprint: dados.fingerprint });
    } else {
      // Daqui para baixo a vaga é DISPUTADA: ou a máquina é nova, ou é uma
      // linha desativada voltando (SPEC-037 §Critérios). Os dois passam pela
      // mesma contagem — voltar não é retorno gratuito, senão desativar e
      // reativar em ciclo tornaria o `maxMachines` decorativo.
      const vivas = await this.prisma.activation.count({
        where: { licenseId: licenca.id, deactivatedAt: null },
      });

      if (vivas >= licenca.max_machines) {
        // 409 COM a lista de máquinas (§Contratos): sem ela o comprador vê
        // "limite atingido" e não tem como saber qual desativar. É esta lista
        // que torna possível a troca self-service do `/deactivate`.
        throw await this.conflitoDeMaquinas(licenca);
      }

      if (existente) {
        // Linha desativada voltando: reocupa a vaga que acabou de ser contada.
        // `update` e não `create` — o unique `(license_id, fingerprint)` recusa
        // a segunda linha, e a trilha da máquina continua inteira.
        await this.prisma.activation.update({
          where: { id: existente.id },
          data: {
            deactivatedAt: null,
            lastSeenAt: new Date(),
            hostname: dados.hostname ?? existente.hostname,
            appVersion: dados.appVersion ?? existente.appVersion,
          },
        });
        await this.evento(licenca, 'reactivated', { fingerprint: dados.fingerprint });
        return this.assinar(licenca, dados.fingerprint);
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

    return this.assinar(licenca, dados.fingerprint);
  }

  /**
   * Assina o license file da licença + máquina.
   *
   * **Chamada por último, sempre.** Se ela falhar (chave ausente → `503`), a
   * ativação já está gravada — e é o lado certo de falhar: uma vaga consumida
   * sem o arquivo se resolve reativando (idempotente), enquanto o inverso
   * entregaria um arquivo de uma ativação que não existe.
   *
   * `signedAt` sai daqui como `now()` do servidor (dentro do `sign`), nunca de
   * nada que venha no request — é sobre ele que o cliente mede a graça de 14
   * dias, então aceitar valor do cliente seria deixar a máquina estender a
   * própria licença (SPEC-037 §Notas técnicas).
   */
  private assinar(licenca: ResolvedLicenseRow, fingerprint: string): LicenseFile {
    return this.signing.sign({
      licenseId: licenca.id,
      edition: licenca.edition_slug,
      billingModel: licenca.billing_model,
      fingerprint,
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
