import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Parâmetros de estimativa por workspace (SPEC-033 §2.6, §6).
 *
 * Vivem em `TenantSettings`, a tabela do ADR-026 — já por tenant, já só o
 * `owner` escreve, que são exatamente as duas regras que a spec pede. Criar uma
 * 2ª tabela de configuração repetiria a mesma tenancy com outro nome.
 *
 * **Convive com `/settings/llm-caps`, e a diferença é o escopo.** Aquela rota é
 * global e resolve o tenant por `personalTenantId(userId)`; esta é
 * `/t/:tenant/...` e usa o tenant **da URL**. Parâmetro de workspace precisa do
 * segundo: com o primeiro, quem participa de dois workspaces editaria sempre o
 * valor/hora do pessoal, achando que mexeu no do cliente. As duas escrevem na
 * mesma tabela de propósito — o bolso é um só; o que muda é como se chega nele.
 */

export interface EstimateSettingsView {
  hourlyRateBrl: string;
  contingencyPercent: string;
  /** `null` é estado legítimo: sem câmbio, o custo de IA fica em USD (§2.6). */
  exchangeRateUsdBrl: string | null;
  exchangeRateAt: string | null;
  /** Resolvido no servidor — a tela mostra leitura para quem não pode editar. */
  canEdit: boolean;
}

export interface UpdateEstimateSettingsInput {
  hourlyRateBrl?: string;
  contingencyPercent?: string;
  /**
   * `null` explícito **limpa** a taxa (volta ao estado "sem câmbio"); ausente
   * não mexe. A distinção existe porque limpar é uma decisão legítima — a
   * cotação de três meses atrás é pior que nenhuma, e sem `null` não haveria
   * como voltar atrás depois de digitar uma vez.
   */
  exchangeRateUsdBrl?: string | null;
}

@Injectable()
export class EstimateSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, role: Role | undefined): Promise<EstimateSettingsView> {
    const s = await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
      select: {
        hourlyRateBrl: true,
        contingencyPercent: true,
        exchangeRateUsdBrl: true,
        exchangeRateAt: true,
      },
    });
    return {
      hourlyRateBrl: s.hourlyRateBrl.toString(),
      contingencyPercent: s.contingencyPercent.toString(),
      exchangeRateUsdBrl: s.exchangeRateUsdBrl?.toString() ?? null,
      exchangeRateAt: s.exchangeRateAt?.toISOString() ?? null,
      canEdit: role === 'owner',
    };
  }

  /**
   * Altera os parâmetros. **Só o `owner`** (§2.6, mesma regra do ADR-026).
   *
   * O papel vem do `TenantGuard`, que já o resolveu para a URL — diferente do
   * `SettingsService`, que consulta a membership à mão porque `/settings` é rota
   * global sem `TenantGuard`.
   */
  async update(
    tenantId: string,
    role: Role | undefined,
    input: UpdateEstimateSettingsInput,
  ): Promise<EstimateSettingsView> {
    if (role !== 'owner') {
      throw new ForbiddenException(
        'Só o dono do workspace altera os parâmetros de estimativa',
      );
    }

    // `Unchecked`: o upsert cria com `tenantId` cru (a variante "checked" exige
    // a relação `tenant: { connect: ... }`, que aqui só daria trabalho — o id já
    // veio validado pelo `TenantGuard`).
    const dados: Prisma.TenantSettingsUncheckedUpdateInput = {};

    if (input.hourlyRateBrl !== undefined) {
      const valor = decimalDe(input.hourlyRateBrl, 'Valor/hora');
      // Valor/hora zero produziria orçamento de R$ 0,00 **com aparência de conta
      // feita** — o pior formato de erro num número que vira proposta. O CHECK
      // no banco barra de qualquer jeito; aqui o motivo chega legível à tela em
      // vez de virar um 500 de constraint.
      if (valor.lessThanOrEqualTo(0)) {
        throw new UnprocessableEntityException('Valor/hora precisa ser maior que zero');
      }
      dados.hourlyRateBrl = valor;
    }

    if (input.contingencyPercent !== undefined) {
      const pct = decimalDe(input.contingencyPercent, 'Contingência');
      if (pct.lessThan(0) || pct.greaterThan(100)) {
        throw new UnprocessableEntityException(
          'Contingência precisa estar entre 0% e 100%',
        );
      }
      dados.contingencyPercent = pct;
    }

    if (input.exchangeRateUsdBrl !== undefined) {
      if (input.exchangeRateUsdBrl === null || input.exchangeRateUsdBrl === '') {
        // Limpar é decisão legítima: cotação velha é pior que nenhuma, porque
        // segue exibida como se fosse corrente. Os dois campos saem juntos — o
        // CHECK do banco exige o par, e taxa sem data é número sem validade.
        dados.exchangeRateUsdBrl = null;
        dados.exchangeRateAt = null;
      } else {
        const taxa = decimalDe(input.exchangeRateUsdBrl, 'Taxa de câmbio');
        if (taxa.lessThanOrEqualTo(0)) {
          throw new UnprocessableEntityException(
            'Taxa de câmbio precisa ser maior que zero',
          );
        }
        dados.exchangeRateUsdBrl = taxa;
        // A data é **do servidor**, não digitada: ela responde "quando esta
        // cotação foi informada", e aceitar do cliente permitiria carimbar hoje
        // uma taxa do ano passado — que é exatamente a confusão que o par
        // taxa+data existe para evitar.
        dados.exchangeRateAt = new Date();
      }
    }

    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      // `tenantId` por ÚLTIMO: se viesse antes, o spread poderia sobrescrevê-lo
      // e a linha nasceria no tenant errado — o tipo de defeito que a RLS não
      // pega, porque a escrita é legítima, só está no lugar errado.
      create: { ...(dados as Prisma.TenantSettingsUncheckedCreateInput), tenantId },
      update: dados,
    });

    return this.get(tenantId, role);
  }
}

/** Converte e recusa o que não é número — `Decimal` aceita lixo e vira `NaN`. */
function decimalDe(valor: string, rotulo: string): Prisma.Decimal {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(valor);
  } catch {
    throw new UnprocessableEntityException(`${rotulo} precisa ser um número`);
  }
  if (!d.isFinite()) {
    throw new UnprocessableEntityException(`${rotulo} precisa ser um número finito`);
  }
  return d;
}
