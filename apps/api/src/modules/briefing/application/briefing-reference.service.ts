import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashToken, linkStatus } from '../domain/briefing-token';

export interface ReferenceOption {
  value: string;
  label: string;
}

export interface CatalogPayload {
  segments: ReferenceOption[];
  states: ReferenceOption[];
  /** Catálogo curado do tenant DONO do link, agrupado por segmento. */
  services: Record<string, string[]>;
}

/** Linha mínima da `resolve_briefing_draft` — só o que a Etapa 1 precisa. */
interface LinkRow {
  tenant_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Dados de referência da Etapa 1 (SPEC-031 §3), servidos à tela pública.
 *
 * Existem porque a spec proíbe consumir o IBGE em runtime: o formulário público
 * ficaria refém de um terceiro no caminho do cliente, e IBGE fora do ar viraria
 * briefing travado. As listas vêm do seed (PR-1) e saem daqui.
 *
 * `segments`, `states` e `cities` são do Brasil inteiro — tabelas **sem RLS**, de
 * propósito: o seletor é montado sem tenant no contexto. Já `services` é curado
 * por tenant, então só sai depois de resolver o link, e o tenant vem do **hash do
 * token** (ADR-020), nunca do request.
 */
@Injectable()
export class BriefingReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Segmentos, estados e catálogo do tenant. As cidades NÃO vêm aqui: são 5.571
   * e mandar todas em toda abertura de link seria pagar ~300 KB para usar uma.
   */
  async getCatalog(token: string): Promise<CatalogPayload> {
    const row = await this.resolveValidLink(token);

    const [segments, states] = await Promise.all([
      this.prisma.segment.findMany({ orderBy: { label: 'asc' } }),
      this.prisma.state.findMany({ orderBy: { name: 'asc' } }),
    ]);

    // O catálogo é do tenant dono do link, então precisa do contexto aberto —
    // `service_catalog_items` é raiz com `tenant_id` e RLS fail-closed. Sem o
    // `runInTenantContext` a lista voltaria vazia em silêncio.
    const items = await this.prisma.runInTenantContext([row.tenant_id], () =>
      this.prisma.serviceCatalogItem.findMany({
        where: { tenantId: row.tenant_id, active: true },
        orderBy: [{ segment: 'asc' }, { label: 'asc' }],
        select: { segment: true, label: true },
      }),
    );

    const services: Record<string, string[]> = {};
    for (const item of items) {
      (services[item.segment] ??= []).push(item.label);
    }

    return {
      segments: segments.map((s) => ({ value: s.code, label: s.label })),
      states: states.map((s) => ({ value: s.code, label: s.name })),
      services,
    };
  }

  /**
   * Cidades de UM estado. Sob demanda porque o cliente escolhe o estado antes —
   * e porque o critério de aceite é literalmente "selecionar estado filtra as
   * cidades daquele estado".
   *
   * Exige token válido mesmo sendo dado público: sem isso a rota viraria um
   * proxy aberto do IBGE hospedado na nossa API, com o nosso rate limit.
   */
  async getCities(token: string, stateCode: string): Promise<ReferenceOption[]> {
    await this.resolveValidLink(token);

    const cities = await this.prisma.city.findMany({
      where: { state: { code: stateCode.toUpperCase() } },
      orderBy: { name: 'asc' },
      select: { ibgeId: true, name: true },
    });

    return cities.map((c) => ({ value: String(c.ibgeId), label: c.name }));
  }

  /**
   * Link válido ou 404 não-diferencial.
   *
   * Expirado, revogado e inexistente respondem igual: aqui não há tela para
   * explicar o estado (o `GET /b/:token` é quem faz isso), e distinguir só
   * daria a quem sonda um oráculo de tokens que já existiram.
   */
  private async resolveValidLink(token: string): Promise<LinkRow> {
    const rows = await this.prisma.$queryRaw<
      LinkRow[]
    >`SELECT tenant_id, expires_at, revoked_at FROM resolve_briefing_draft(${hashToken(token)})`;

    const row = rows[0];
    const status = linkStatus(
      row ? { expiresAt: row.expires_at, revokedAt: row.revoked_at } : null,
    );
    if (!row || status !== 'valid') {
      throw new NotFoundException('link não encontrado');
    }

    return row;
  }
}
