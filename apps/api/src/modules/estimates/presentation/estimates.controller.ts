import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { EffortBreakdownService } from '../application/effort-breakdown.service';
import { ESTIMATES_QUEUE } from '../estimates.constants';
import type { EffortJobData } from '../infrastructure/estimates.worker';

/**
 * Decomposição de esforço no painel do prestador (SPEC-033 §6).
 *
 * **Nenhuma rota pública** — o cliente não vê estimativa (§2.13); o número chega
 * a ele pelo contrato (SPEC-034). Tudo aqui é autenticado e sob `withTenant`.
 *
 * A edição humana do `effort_breakdown` **não tem rota nova**: reaproveita
 * `POST /t/:tenant/artifacts/:id/versions` da SPEC-032, que já cria versão
 * `human` com `parentVersionId`. Uma rota de edição própria aqui duplicaria o
 * contrato de linhagem e as duas divergiriam na primeira correção.
 */
@Controller('t/:tenant')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class EstimatesController {
  constructor(
    private readonly effort: EffortBreakdownService,
    @InjectQueue(ESTIMATES_QUEUE) private readonly queue: Queue<EffortJobData>,
  ) {}

  /** Estado da decomposição + se o botão de gerar pode aparecer. */
  @Get('client-projects/:id/effort-breakdown')
  read(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.effort.read(req.tenantId!, id);
  }

  /**
   * Dispara a geração. **Enfileira e devolve** — nenhuma chamada de IA no
   * caminho da request (ADR-002): quem clica recebe a resposta sem esperar o
   * modelo.
   *
   * A validação de `ARTIFACTS_READY` acontece **antes** de enfileirar, para que
   * o motivo legível chegue à tela como resposta do clique, e não só num run
   * `FAILED` que a pessoa precisaria ir procurar. O service revalida no worker
   * pelo motivo oposto: o card pode ter mudado de estado entre o clique e o job.
   */
  @Post('client-projects/:id/effort-breakdown/generate')
  async generate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.tenantId!;
    await this.effort.assertCanGenerate(tenantId, id);

    const tentativa = await this.effort.nextAttempt(tenantId, id);
    await this.queue.add(
      'effort',
      { clientProjectId: id, tenantId },
      {
        // Chave por (projeto, TENTATIVA), e não fixa por projeto: com id fixo, o
        // job de uma geração que falhou continuaria em `completed` no Redis
        // (`removeOnComplete`) e o `add` seguinte seria **descartado em
        // silêncio** — o botão pararia de funcionar sem nada no log. Foi
        // exatamente o achado do dogfooding da Fatia 21.
        jobId: `effort_${id}_${tentativa}`,
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );

    return { enqueued: true };
  }
}
