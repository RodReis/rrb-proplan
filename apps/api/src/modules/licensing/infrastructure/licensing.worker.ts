import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogSyncService } from '../application/catalog-sync.service';
import { LicenseExpirySweepService } from '../application/license-expiry-sweep.service';
import { SourceInviteService } from '../application/source-invite.service';
import type { WebhookJobData } from '../application/webhook-intake.service';
import { WebhookProcessorService } from '../application/webhook-processor.service';
import {
  CATALOG_SYNC_JOB,
  EXPIRY_SWEEP_JOB,
  LICENSING_QUEUE,
  SOURCE_RECONCILE_JOB,
} from '../licensing.constants';

/**
 * Processa o evento de webhook fora da request (SPEC-038 §Notas técnicas) **e** a
 * rodada diária do catálogo (SPEC-047, ADR-029).
 *
 * **`concurrency: 1`**, como o `board`. Dois eventos da mesma venda processados
 * em paralelo disputariam a emissão: o `saleRef` único do banco recusaria o
 * segundo, mas com erro na lista de pendências em vez de silêncio — e o volume
 * do piloto não pede paralelismo nenhum.
 *
 * ## Dois tipos de job na mesma fila, roteados por nome
 *
 * Uma fila nova só para o sync custaria uma conexão Redis e um worker a mais
 * para rodar uma vez por dia. O que separa os dois é o `job.name`, e o
 * `concurrency: 1` que já existia passa a ser uma garantia extra: a rodada do
 * catálogo nunca disputa com o processamento de uma venda.
 */
@Processor(LICENSING_QUEUE, { concurrency: 1 })
export class LicensingWorker extends WorkerHost {
  private readonly logger = new Logger(LicensingWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: WebhookProcessorService,
    private readonly catalogSync: CatalogSyncService,
    private readonly invites: SourceInviteService,
    private readonly expiry: LicenseExpirySweepService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    if (job.name === CATALOG_SYNC_JOB) {
      await this.sincronizarCatalogos(job);
      return;
    }

    if (job.name === SOURCE_RECONCILE_JOB) {
      await this.reconciliarConvites(job);
      return;
    }

    if (job.name === EXPIRY_SWEEP_JOB) {
      await this.varrerExpiradas(job);
      return;
    }

    const { webhookEventId, tenantId } = job.data;
    this.logger.log(`Licensing job ${job.id} → evento ${webhookEventId}`);

    // Fora de request o RLS é fail-closed: ler ou gravar sem contexto NÃO dá
    // erro, dá ZERO LINHAS. Um evento "processado" que não achou a licença tem
    // a mesma cara de um evento cuja venda não existe.
    await this.prisma.runInTenantContext([tenantId], () =>
      this.processor.process(webhookEventId, tenantId),
    );
  }

  /**
   * A rodada diária: um sync por tenant com credenciais configuradas.
   *
   * **Um tenant que falha não derruba os outros.** O `sincronizar` já não lança
   * por falha da Kiwify (grava `fetchError` e segue), mas o `try` aqui cobre o
   * que ele não prevê — um erro de banco no meio da lista deixaria os tenants
   * seguintes sem rodada, e o sintoma seria "o catálogo de alguns nunca
   * atualiza", sem nada em log ligando um caso ao outro.
   *
   * A varredura de tenants roda **fora** de contexto (é a pergunta *"quais
   * tenants?"*); cada sync roda **dentro** do contexto do seu, porque tudo o que
   * ele lê e grava é dado de tenant e o RLS é fail-closed (ADR-029, decisão 4).
   */
  private async sincronizarCatalogos(job: Job): Promise<void> {
    const tenants = await this.catalogSync.tenantsConfigurados();
    this.logger.log(
      `Sync de catálogo (job ${job.id}): ${tenants.length} tenant(s) com credenciais`,
    );

    for (const tenantId of tenants) {
      try {
        await this.prisma.runInTenantContext([tenantId], () =>
          this.catalogSync.sincronizar(tenantId),
        );
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        this.logger.error(`Sync do tenant ${tenantId} falhou fora do previsto: ${motivo}`);
      }
    }
  }

  /**
   * A rodada do convite ao source: um `reconcile` por tenant com PAT (SPEC-048).
   *
   * **Este é o job que o gatilho por evento também enfileira** — mesmo nome,
   * mesma execução. Quem gravou o username não ganha um caminho próprio: ganha
   * uma rodada antecipada. É o que mantém uma única lógica de convite, com uma
   * única guarda de prazo.
   *
   * **Um tenant que falha não derruba os outros** — um PAT expirado num tenant
   * deixaria todos os seguintes sem rodada, e o sintoma seria "o convite de
   * alguns nunca sai", sem nada em log ligando um caso ao outro. O `reconcile` já
   * não lança por falha do GitHub (grava `sourceAccessError` e segue); o `try`
   * cobre o que ele não prevê.
   *
   * O `runInTenantContext` é aberto **aqui**, porque o `reconcile` documenta que
   * é chamado já dentro do contexto — sem ele o RLS fail-closed devolveria zero
   * linhas **sem erro**, e a rodada reportaria sucesso tendo feito nada.
   */
  private async reconciliarConvites(job: Job): Promise<void> {
    const tenants = await this.invites.tenantsComSource();
    this.logger.log(
      `Reconciliação de convite (job ${job.id}): ${tenants.length} tenant(s) com PAT`,
    );

    for (const tenantId of tenants) {
      try {
        const resultado = await this.prisma.runInTenantContext([tenantId], () =>
          this.invites.reconcile(tenantId),
        );
        if (resultado.convidados > 0 || resultado.aceitos > 0 || resultado.falhas > 0) {
          this.logger.log(
            `Tenant ${tenantId}: ${resultado.convidados} convidado(s), ` +
              `${resultado.aceitos} aceito(s), ${resultado.falhas} falha(s), ` +
              `${resultado.aguardandoUsername} aguardando username`,
          );
        }
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        this.logger.error(
          `Reconciliação do tenant ${tenantId} falhou fora do previsto: ${motivo}`,
        );
      }
    }
  }

  /**
   * A rodada da expiração: um `sweep` por tenant com licença (SPEC-048).
   *
   * **O `sweep` abre o próprio `runInTenantContext`** — ao contrário do
   * `reconcile`, que exige o contexto já aberto pelo chamador. A assimetria é dos
   * services, não deste worker; envolver de novo aqui aninharia contexto sem
   * necessidade.
   *
   * O `try` por tenant existe pelo mesmo motivo dos outros dois jobs, embora aqui
   * o risco seja o menor da fila: um `updateMany` local, sem rede no caminho.
   */
  private async varrerExpiradas(job: Job): Promise<void> {
    const tenants = await this.expiry.tenantsComLicenca();
    this.logger.log(
      `Sweep de expiração (job ${job.id}): ${tenants.length} tenant(s) com licença`,
    );

    for (const tenantId of tenants) {
      try {
        await this.expiry.sweep(tenantId);
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro);
        this.logger.error(
          `Sweep do tenant ${tenantId} falhou fora do previsto: ${motivo}`,
        );
      }
    }
  }
}
