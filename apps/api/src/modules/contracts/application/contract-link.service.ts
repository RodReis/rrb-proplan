import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  contractLinkStatus,
  defaultExpiration,
  generateToken,
  hashToken,
  type ContractLinkStatus,
} from '../domain/contract-token';

export interface CreatedContractLink {
  id: string;
  /** Token em claro — devolvido UMA ÚNICA VEZ, nunca persistido nem relido. */
  token: string;
  expiresAt: Date;
}

/** O que a rota pública devolve. Sem contrato quando o link não serve. */
export interface PublicContractResponse {
  status: ContractLinkStatus;
  contract?: {
    renderedHtml: string;
    version: number;
    expiresAt: string;
  };
}

/** Colunas devolvidas pela função `resolve_contract_link` (PR-1). */
interface ResolvedLinkRow {
  id: string;
  expires_at: Date;
  revoked_at: Date | null;
  tenant_id: string;
  contract_id: string;
  client_project_id: string;
}

/**
 * Ciclo de vida do link público do contrato (SPEC-034 §2.7, §2.8 e §2.11).
 *
 * ## O que este service protege
 *
 * O link expõe **CPF/CNPJ e endereço completos das duas partes** numa URL sem
 * autenticação — decisão 8.1 do PI, tomada em voz alta junto com as mitigações
 * que a acompanham. Três delas moram aqui:
 *
 * 1. **Prazo de 48 h, sempre** (§2.8). Não há caminho que crie link sem prazo:
 *    a coluna é NOT NULL (PR-1) e o `defaultExpiration` é o outro lado disso.
 * 2. **Revogação com efeito imediato** — a próxima requisição já não passa,
 *    porque o estado é lido do banco a cada acesso, nunca de cache.
 * 3. **Auditoria sem IP e sem user agent** (§2.11). Guardar IP seria coletar
 *    mais dado pessoal na fatia cujo problema é justamente excesso de dado
 *    pessoal. A ausência é provada por teste.
 *
 * ## Por que a resolução pública passa por função SQL
 *
 * `GET /c/:token` não tem sessão, então roda **sem** `app.tenant_ids`, e o RLS
 * destas tabelas é fail-closed: um SELECT direto voltaria vazio para TODO token,
 * inclusive os válidos — e cada link legítimo responderia "inválido", sem erro
 * no log. É a mesma classe de bug que já custou 5 ocorrências nesta frente.
 *
 * A `resolve_contract_link` (SECURITY DEFINER, PR-1) responde só *"este token
 * serve, e para qual contrato?"*. Ela **não** devolve o `rendered_html`: o
 * documento é lido depois, já sob o contexto do tenant que ela descobriu — assim
 * quem protege o conteúdo continua sendo o RLS, não a lista de colunas de uma
 * função privilegiada.
 */
@Injectable()
export class ContractLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera (ou regenera) o link de um contrato.
   *
   * Regenerar **revoga o anterior**: dois links vivos para o mesmo contrato
   * significaria que revogar um não fecha o acesso, que é o oposto do que
   * "revogar" promete.
   *
   * Roda sob o contexto de tenant aberto pelo interceptor (rota `/t/:tenant`).
   */
  async createOrRegenerate(
    tenantId: string,
    contractId: string,
  ): Promise<CreatedContractLink> {
    await this.assertContract(tenantId, contractId);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();

    // Interativa, não lote: sob contexto de tenant o lote sairia em duas
    // conexões (issue #113 e `batch-transaction.arch.spec.ts`).
    const link = await this.prisma.$transaction(async (tx) => {
      await tx.contractLink.updateMany({
        where: { contractId, revokedAt: null },
        data: { revokedAt: now },
      });
      return tx.contractLink.create({
        data: {
          contractId,
          tokenHash,
          expiresAt: defaultExpiration(now),
        },
      });
    });

    await this.audit(tenantId, 'contract_link.created', contractId, {
      linkId: link.id,
      expiresAt: link.expiresAt.toISOString(),
    });

    // O token em claro só existe aqui e na resposta. Nem log, nem AuditEvent.
    return { id: link.id, token, expiresAt: link.expiresAt };
  }

  /** Revogação em 1 clique (§2.8). Idempotente: sem link ativo, `revoked: 0`. */
  async revoke(tenantId: string, contractId: string) {
    await this.assertContract(tenantId, contractId);

    const { count } = await this.prisma.contractLink.updateMany({
      where: { contractId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit(tenantId, 'contract_link.revoked', contractId, { count });
    return { revoked: count };
  }

  /** Metadados do link ativo — nunca o token (que não é recuperável). */
  async getActive(tenantId: string, contractId: string) {
    await this.assertContract(tenantId, contractId);

    const link = await this.prisma.contractLink.findFirst({
      where: { contractId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, createdAt: true },
    });

    if (!link) return { active: false as const };
    return {
      active: true as const,
      ...link,
      status: contractLinkStatus({ expiresAt: link.expiresAt, revokedAt: null }),
    };
  }

  /**
   * Resolução PÚBLICA do token (`GET /c/:token`) — sem sessão.
   *
   * Não-diferencial: token inexistente e de outro tenant devolvem o MESMO
   * `invalid`. Expirado e revogado devolvem o próprio estado, porque quem tem um
   * link legítimo precisa saber **por que** ele parou de funcionar — mas nenhum
   * dos quatro vaza tenant, cliente, projeto ou id de link.
   */
  async resolvePublic(token: string): Promise<PublicContractResponse> {
    const tokenHash = hashToken(token);
    const rows = await this.prisma.$queryRaw<
      ResolvedLinkRow[]
    >`SELECT * FROM resolve_contract_link(${tokenHash})`;

    const row = rows[0];
    const status = contractLinkStatus(
      row ? { expiresAt: row.expires_at, revokedAt: row.revoked_at } : null,
    );

    // Token que não resolve não tem tenant a descobrir — não há sob qual
    // contexto auditar, e inventar um vazaria a existência do link.
    if (!row) return { status };

    return this.prisma.runInTenantContext([row.tenant_id], async () => {
      await this.auditAccess(row, status);

      if (status !== 'valid') return { status };

      const contract = await this.prisma.contract.findUnique({
        where: { id: row.contract_id },
        select: { renderedHtml: true, version: true },
      });

      // Corrida real: o contrato pode ter sumido entre a resolução e a leitura.
      if (!contract) return { status: 'invalid' as const };

      return {
        status,
        contract: {
          renderedHtml: contract.renderedHtml,
          version: contract.version,
          expiresAt: row.expires_at.toISOString(),
        },
      };
    });
  }

  /**
   * Auditoria do acesso — **sem IP e sem user agent** (§2.11).
   *
   * O `payload` é montado aqui, com campos nomeados um a um, em vez de receber
   * um objeto de fora: é o que impede alguém de, meses depois, passar o `req`
   * inteiro e derrubar a garantia sem perceber. O teste afirma a ausência.
   */
  private async auditAccess(row: ResolvedLinkRow, status: ContractLinkStatus) {
    await this.audit(row.tenant_id, 'contract_link.accessed', row.contract_id, {
      status,
      linkId: row.id,
    });
  }

  /** Existe e é deste tenant? 404 não-diferencial para alheio e inexistente. */
  private async assertContract(tenantId: string, contractId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId },
      select: { id: true },
    });
    if (!contract) throw new NotFoundException('contrato não encontrado');
  }

  /** Ver `ClientsService.audit`: perder o evento é melhor que desfazer o fato. */
  private async audit(
    tenantId: string,
    kind: string,
    subject: string,
    payload: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.auditEvent.create({
        data: { tenantId, kind, subject, payload },
      });
    } catch {
      // ponytail: silencioso de propósito, como no ClientsService.
    }
  }
}
