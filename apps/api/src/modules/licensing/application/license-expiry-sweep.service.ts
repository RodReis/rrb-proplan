import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Materializa `status = EXPIRED` para o admin enxergar (SPEC-038, PR-4).
 *
 * ## Este serviço não decide nada
 *
 * A spec é explícita, duas vezes: *"expiração é avaliada na validação
 * (`/activate`, `/heartbeat` comparam `expiresAt` com `now`), nunca dependente
 * de job"*, e *"job diário atrasado ou morto não pode conceder acesso"*.
 *
 * Então o que ele faz é **só escrever o que já é verdade**: uma licença cujo
 * `expiresAt` passou já responde `410` desde o instante exato do vencimento,
 * tenha este job rodado ou não. Sem ele, o admin veria `ACTIVE` numa linha que
 * as rotas já recusam — o número na tela discordando do comportamento real.
 *
 * A consequência de desenho vale registrar: **este job pode morrer por semanas
 * sem afetar acesso nenhum**. O pior caso é a lista do admin ficar desatualizada
 * — nunca um cliente entrando onde não devia, nem sendo barrado onde devia
 * entrar. É de propósito que a única escrita aqui seja para um estado que a
 * validação já aplica sozinha.
 *
 * ## Por que não toca em `pastDueAt`
 *
 * Inadimplência é reversível: o evento de pagamento aprovado limpa `pastDueAt` e
 * o acesso volta (PR-3). Materializar um `status` de atraso criaria um estado do
 * qual o caminho de volta teria de saber voltar — e ele não sabe. Expiração é
 * diferente: `expiresAt` no passado só muda por renovação, que reescreve a
 * própria data.
 */
@Injectable()
export class LicenseExpirySweepService {
  private readonly logger = new Logger(LicenseExpirySweepService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Os tenants que a rodada diária varre (SPEC-048).
   *
   * **Sem filtro de credencial nenhum**, ao contrário dos outros dois jobs da
   * fila. O sync do catálogo precisa da Kiwify e o convite precisa do PAT, mas o
   * sweep é `updateMany` local: não fala com ninguém de fora. Condicioná-lo a uma
   * credencial deixaria licença vencida como `ACTIVE` na tela de todo tenant que
   * não vende pela Kiwify — o desencontro exato que este job existe para fechar.
   *
   * A lista sai da tabela que o job realmente escreve, e não de `Tenant`: quem
   * nunca emitiu licença não tem o que expirar. Atravessa tenants e devolve só
   * ids — o `runInTenantContext` entra por tenant, dentro do `sweep` (ADR-029,
   * decisão 4).
   *
   * **Passa pela função `SECURITY DEFINER`, e não por `license.findMany`**
   * (ADR-030). `proplan_app` é `NOBYPASSRLS` e a política das `lic_*` compara com
   * `app.tenant_ids`: fora de contexto o `findMany` devolve **zero linhas sem
   * erro** — a rodada varreria ninguém e reportaria sucesso. O que prova isto é
   * int-spec contra Postgres real; **mock de Prisma não tem RLS**.
   */
  async tenantsComLicenca(): Promise<string[]> {
    const linhas = await this.prisma.$queryRaw<
      { tenant_id: string }[]
    >`SELECT tenant_id FROM lic_tenants_with_expiring_licenses()`;
    return linhas.map((l) => l.tenant_id);
  }

  /**
   * Marca como `EXPIRED` toda licença `ACTIVE` cujo `expiresAt` já passou.
   *
   * Devolve quantas linhas mudaram — número que o chamador loga, e que num dia
   * normal é zero.
   *
   * Roda **sob contexto do tenant**: fora dele o `updateMany` do RLS fail-closed
   * afetaria zero linhas **sem erro**, e o job reportaria sucesso tendo feito
   * nada. É a mesma armadilha dos workers da Fatia 8.
   */
  async sweep(tenantId: string): Promise<number> {
    const { count } = await this.prisma.runInTenantContext([tenantId], () =>
      this.prisma.license.updateMany({
        where: {
          status: 'ACTIVE',
          // `null` (PERPETUAL) nunca expira — o Prisma não inclui NULL num
          // filtro `lt`, mas ser explícito impede que uma edição futura do
          // filtro passe a varrer licenças perpétuas.
          expiresAt: { not: null, lt: new Date() },
        },
        data: { status: 'EXPIRED' },
      }),
    );

    if (count > 0) {
      this.logger.log(`Tenant ${tenantId}: ${count} licença(s) materializada(s) EXPIRED`);
    }
    return count;
  }
}
