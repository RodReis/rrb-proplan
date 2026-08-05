import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogSyncService } from '../application/catalog-sync.service';
import type { WebhookJobData } from '../application/webhook-intake.service';
import { WebhookProcessorService } from '../application/webhook-processor.service';
import { CATALOG_SYNC_JOB, LICENSING_QUEUE } from '../licensing.constants';

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
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    if (job.name === CATALOG_SYNC_JOB) {
      await this.sincronizarCatalogos(job);
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
}
