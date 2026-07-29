import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** Faixa aceita para o limite de "parado", em dias. */
const MIN_STALLED_DAYS = 1;
const MAX_STALLED_DAYS = 365;

export interface DashboardSettingsView {
  stalledDays: number;
  /** Resolvido no servidor — a tela mostra leitura para quem não pode editar. */
  canEdit: boolean;
}

/**
 * O limite de "parado" do dashboard (SPEC-035 §6).
 *
 * Vive em `TenantSettings` — a mesma tabela dos parâmetros de estimativa, pelo
 * mesmo motivo: já é por tenant e já só o `owner` escreve (ADR-026). O §6 é
 * explícito em **não** criar tabela de configuração nova.
 *
 * **Este é o único ponto de escrita do módulo `dashboard`**, e escreve na
 * própria configuração dele, não em dado de outro módulo. O "o dashboard não
 * guarda nada" do §2 é sobre os números da tela — eles são derivados a cada
 * leitura, sem cache e sem tabela (§7.4).
 */
@Injectable()
export class DashboardSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O limite em dias, criando a linha de settings se ainda não existir.
   *
   * `upsert` e não `findUnique` porque tenant novo não tem linha, e devolver
   * "sem configuração" obrigaria cada chamador a reimplementar o default — que
   * é como um `7` literal volta a se espalhar pelo código.
   */
  async stalledDays(tenantId: string): Promise<number> {
    const s = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
      select: { stalledDays: true },
    });
    return s.stalledDays;
  }

  async get(tenantId: string, role: Role | undefined): Promise<DashboardSettingsView> {
    return { stalledDays: await this.stalledDays(tenantId), canEdit: role === 'owner' };
  }

  /**
   * Altera o limite. **Só o `owner`** (ADR-026).
   *
   * O papel vem do `TenantGuard`, que já o resolveu para a URL — nunca do corpo
   * da request (regra 1 do ADR-020).
   */
  async update(
    tenantId: string,
    role: Role | undefined,
    stalledDays: number,
  ): Promise<DashboardSettingsView> {
    if (role !== 'owner') {
      throw new ForbiddenException('só o owner altera os parâmetros do workspace');
    }
    if (
      !Number.isInteger(stalledDays) ||
      stalledDays < MIN_STALLED_DAYS ||
      stalledDays > MAX_STALLED_DAYS
    ) {
      throw new UnprocessableEntityException(
        `o limite de "parado" deve ser inteiro entre ${MIN_STALLED_DAYS} e ${MAX_STALLED_DAYS} dias`,
      );
    }

    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, stalledDays },
      update: { stalledDays },
    });
    return { stalledDays, canEdit: true };
  }
}
