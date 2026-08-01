import {
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashKey } from '../domain/license-key';
import { truncarRelato, type RelatoTruncavel } from '../domain/error-report-cap';

/**
 * `POST /licensing/v1/errors` (SPEC-043 §Contratos) — o bug do app licenciado
 * chega com contexto suficiente para diagnóstico e retorno ao comprador.
 *
 * ## O gate é `401`, e não os `404`/`410` das outras rotas públicas
 *
 * Deliberado, e a diferença é de propósito. `/activate` e `releases/*` precisam
 * dizer ao cliente **o que fazer**: `404` é "confira a chave que digitou", `410`
 * é "renove". Aqui não há nada para o cliente fazer — ele está reportando um
 * erro, não pedindo acesso. Distinguir chave inexistente de chave revogada
 * serviria só a quem sonda o servidor, e a spec pede um código só.
 *
 * **Revogada não relata.** A licença revogada é a do reembolsado; aceitar o
 * relato dela abriria a porta que a revogação fechou — um canal de escrita ativo
 * para quem já não é cliente. Expirada e inadimplente **relatam**: a chave não
 * deixou de ser dela, e o bug de quem esqueceu de renovar continua sendo bug
 * nosso.
 *
 * ## Nunca recusa por tamanho
 *
 * `413` transformaria o relato mais interessante — o do crash com stack fundo e
 * sessão longa — no único que não chega. O cap trunca (§Critérios de aceite), e
 * `sessionTail` sai primeiro porque é o campo grande e o menos essencial dos
 * três: sem ele ainda há mensagem e stack, que é o que abre o diagnóstico.
 */

export interface ErrorReportInput {
  licenseKey?: unknown;
  appVersion?: unknown;
  os?: unknown;
  occurredAt?: unknown;
  message?: unknown;
  stack?: unknown;
  sessionTail?: unknown;
  source?: unknown;
  userNote?: unknown;
  contactEmail?: unknown;
}

/** Campos livres vindos de fora, sem sessão. */
const MAX_APP_VERSION = 32;
const MAX_OS = 32;
const MAX_CONTACT_EMAIL = 320;

@Injectable()
export class ErrorReportService {
  private readonly logger = new Logger(ErrorReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async receive(input: ErrorReportInput): Promise<{ received: true }> {
    const licenseKey = texto(input.licenseKey);
    const message = texto(input.message);
    const appVersion = texto(input.appVersion).slice(0, MAX_APP_VERSION);
    const os = texto(input.os).slice(0, MAX_OS);

    if (!licenseKey) throw new UnauthorizedException('Chave inválida');
    if (!message || !appVersion || !os) {
      throw new UnprocessableEntityException(
        '`message`, `appVersion` e `os` são obrigatórios',
      );
    }

    const source = input.source === 'manual' ? 'MANUAL' : 'CRASH';

    // `occurredAt` inválido vira "agora" em vez de recusar: o relógio da máquina
    // do cliente não é problema dele, e perder o relato por causa de um campo de
    // metadado seria trocar diagnóstico por rigor sem ganho. `receivedAt` é o
    // nosso, e é ele que ordena a lista e governa o purge.
    const occurredAt = data(input.occurredAt) ?? new Date();

    const licenca = await this.resolver(licenseKey);

    const truncado = truncarRelato({
      message,
      stack: texto(input.stack) || null,
      userNote: texto(input.userNote) || null,
      sessionTail: input.sessionTail ?? null,
    });

    // Sob contexto do tenant DONO da licença: fora dele o RLS fail-closed
    // gravaria zero linhas SEM erro, e a rota responderia `202` para um relato
    // que não existe. É a mesma armadilha do `/activate` e dos workers.
    await this.prisma.runInTenantContext([licenca.tenantId], () =>
      this.prisma.licErrorReport.create({
        data: {
          tenantId: licenca.tenantId,
          licenseId: licenca.id,
          appVersion,
          os,
          occurredAt,
          message: truncado.message,
          stack: truncado.stack,
          sessionTail: truncado.sessionTail as Prisma.InputJsonValue,
          source,
          userNote: truncado.userNote,
          contactEmail: texto(input.contactEmail).slice(0, MAX_CONTACT_EMAIL) || null,
        },
      }),
    );

    if (truncado.truncated) {
      this.logger.log(`Relato da licença ${licenca.id} truncado no cap de payload`);
    }

    // `202`, não `201`: o cliente não precisa do id nem de nada nosso, e
    // devolver a linha criada daria a um canal público a forma exata do que
    // guardamos. "Recebi" é toda a resposta que o contrato promete.
    return { received: true };
  }

  /**
   * `keyHash → licença viva`, ou `401`.
   *
   * Usa a mesma `resolve_license` (SECURITY DEFINER) das outras rotas públicas:
   * sem sessão, um `SELECT` direto em `licenses` bateria no RLS fail-closed e
   * devolveria vazio para **toda** chave — lido aqui como "chave inválida", e
   * nenhum relato jamais entraria, sem um erro em log sequer.
   */
  private async resolver(key: string): Promise<{ id: string; tenantId: string }> {
    const linhas = await this.prisma.$queryRaw<
      Array<{ id: string; tenant_id: string; status: string }>
    >`SELECT id, tenant_id, status FROM resolve_license(${hashKey(key)})`;

    const licenca = linhas[0];
    // Inexistente e revogada respondem igual — ver o cabeçalho da classe.
    if (!licenca || licenca.status === 'REVOKED') {
      throw new UnauthorizedException('Chave inválida');
    }

    return { id: licenca.id, tenantId: licenca.tenant_id };
  }
}

/** `unknown` → string aparada. Entrada de rota pública nunca é confiável. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** `unknown` → `Date` válida, ou `null` (o chamador decide o fallback). */
function data(valor: unknown): Date | null {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type { RelatoTruncavel };
