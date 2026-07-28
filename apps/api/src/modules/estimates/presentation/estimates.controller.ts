import { InjectQueue } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { EffortBreakdownService } from '../application/effort-breakdown.service';
import { EstimatesService, type GenerateInput } from '../application/estimates.service';
import { ESTIMATES_QUEUE } from '../estimates.constants';
import type { DirectCost } from '../domain/calculation';
import type { EffortJobData } from '../infrastructure/estimates.worker';

interface GenerateEstimateBody {
  directCosts?: unknown;
  aiCostProjectedUsd?: unknown;
}

/**
 * Normaliza os custos diretos digitados (§2.7): descarta item sem rótulo ou com
 * valor não-numérico.
 *
 * Descartar e não corrigir: um valor ilegível "corrigido" para zero entraria no
 * subtotal como se fosse decisão de alguém, e o item sumiria da conta sem
 * sumir da tela. O que chega errado não entra.
 */
function normalizarCustos(bruto: unknown): DirectCost[] {
  if (!Array.isArray(bruto)) return [];
  const out: DirectCost[] = [];
  for (const item of bruto) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    const label = String(c.label ?? '').trim();
    const valor = Number(c.valueBrl);
    if (label === '' || !Number.isFinite(valor) || valor < 0) continue;
    out.push({ label, valueBrl: String(c.valueBrl) });
  }
  return out;
}

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
    private readonly estimates: EstimatesService,
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

  /** Versões da estimativa, mais recente primeiro (§6). */
  @Get('client-projects/:id/estimates')
  listEstimates(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.estimates.list(req.tenantId!, id);
  }

  /**
   * Calcula uma versão nova (§6). **Sempre cria** — reestimar nunca sobrescreve
   * (§2.10).
   *
   * `POST` e síncrono, ao contrário da decomposição: aqui **não há IA**, só
   * soma e multiplicação sobre dados que já estão no banco. Enfileirar um
   * cálculo determinístico de milissegundos só adiaria a resposta e obrigaria a
   * tela a fazer polling por um número que já estaria pronto.
   */
  @Post('client-projects/:id/estimates/generate')
  generateEstimate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: GenerateEstimateBody,
  ) {
    const input: GenerateInput = {
      directCosts: normalizarCustos(body?.directCosts),
      aiCostProjectedUsd:
        body?.aiCostProjectedUsd === undefined || body.aiCostProjectedUsd === null
          ? undefined
          : String(body.aiCostProjectedUsd),
    };
    return this.estimates.generate(req.tenantId!, id, req.userId!, input);
  }

  /** Uma versão, com a conta inteira. */
  @Get('estimates/:id')
  estimate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.estimates.byId(req.tenantId!, id);
  }

  /**
   * Aprova a estimativa. **Só aqui o card se move** (§2.11, §7.1) — o `approve`
   * do `effort_breakdown` é aprovação de artefato comum e não move nada.
   *
   * Rota separada, método separado e rótulo separado na tela: se os dois botões
   * parecerem o mesmo, a decisão do PI vira ambígua na prática.
   */
  @Post('estimates/:id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.estimates.approve(req.tenantId!, id, req.userId!);
  }
}
