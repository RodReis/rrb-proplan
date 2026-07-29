import { Injectable } from '@nestjs/common';
import {
  ActivitySummaryService,
  type TenantActivityEntry,
} from '../../activity/application/activity-summary.service';
import { ArtifactsSummaryService } from '../../artifacts/application/artifacts-summary.service';
import {
  ClientsSummaryService,
  type FunnelColumnCount,
} from '../../clients/application/clients-summary.service';
import {
  ContractsSummaryService,
  type ContractCounts,
} from '../../contracts/application/contracts-summary.service';
import { EstimatesSummaryService } from '../../estimates/application/estimates-summary.service';
import { DashboardSettingsService } from './dashboard-settings.service';
import { periodStart, type Period } from '../domain/period';
import { PENDING_KINDS, type PendingItem } from '../domain/pending';

/** Quantas linhas de trilha o bloco de retomada mostra. */
const ACTIVITY_LIMIT = 12;

export interface ActivityFeedEntry {
  kind: 'funnel' | 'audit' | 'sync';
  at: string;
  title: string;
  detail: string;
  clientProjectId: string | null;
}

export interface DashboardView {
  period: Period;
  /**
   * Tenant sem cliente nenhum. O item de menu **some** neste caso (§2.12), e a
   * tela inteira mostra o estado de primeira vez — diferente de aparecer vazia.
   */
  hasAnyClient: boolean;
  activity: ActivityFeedEntry[];
  pending: PendingItem[];
  funnel: FunnelColumnCount[];
  contracts: ContractCounts;
}

/**
 * O agregador do dashboard (SPEC-035).
 *
 * ## Composição, não módulo de dados
 *
 * **Nenhuma tabela nova, nenhuma entidade nova, nada gravado** (§2, §3). Este
 * service só chama services públicos dos módulos donos de cada fato e monta a
 * resposta. Ele **não tem `PrismaService`** — e essa ausência é o mecanismo, não
 * um detalhe: sem o cliente injetado, não há como consultar tabela de outro
 * módulo nem por acidente. O `dashboard.arch.spec.ts` prova isso por varredura,
 * porque o `PrismaService` é global e o `@Module` do Nest resolve injeção, não
 * import de TypeScript (ADR-027).
 *
 * ## Uma chamada, não seis (§6)
 *
 * O dashboard é uma tela. Seis requests dariam seis estados de carregamento numa
 * página que deveria abrir pronta. O bloco de repos é a exceção deliberada — vai
 * em rota própria para que a falha dele (§2.11) não contamine esta resposta.
 *
 * ## Nenhum número cruza as duas frentes (ADR-023, §2.4)
 *
 * Não há total agregado nesta view, e não há de onde tirar um: o funil de
 * clientes e o board de repos nem viajam na mesma resposta. A ausência é
 * auditável, que é como o §5 pede.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly clients: ClientsSummaryService,
    private readonly artifacts: ArtifactsSummaryService,
    private readonly estimates: EstimatesSummaryService,
    private readonly contracts: ContractsSummaryService,
    private readonly activity: ActivitySummaryService,
    private readonly settings: DashboardSettingsService,
  ) {}

  /** Blocos locais — tudo menos repos. */
  async view(tenantId: string, period: Period, agora: Date): Promise<DashboardView> {
    const desde = periodStart(period, agora);

    const [hasAnyClient, funnel, contracts, pending, activity] = await Promise.all([
      this.clients.hasAnyClient(tenantId),
      this.clients.funnel(tenantId, desde),
      this.contracts.counts(tenantId, desde),
      this.pending(tenantId, agora),
      this.activityFeed(tenantId, desde),
    ]);

    return { period, hasAnyClient, activity, pending, funnel, contracts };
  }

  /**
   * *Esperando você* — os 4 itens da lista fechada (§2.3).
   *
   * **É estado corrente, não janela**: o período não entra aqui. Algo que espera
   * há 200 dias espera hoje, e escondê-lo por estar fora dos últimos 30 seria a
   * pior forma de mentir nesta tela.
   *
   * A ordem segue `PENDING_KINDS`, e é dela que sai o contador — ver
   * `pendingCount`.
   */
  async pending(tenantId: string, agora: Date): Promise<PendingItem[]> {
    const stalledDays = await this.settings.stalledDays(tenantId);

    const [artefatos, estimativas, contratos, parados] = await Promise.all([
      this.artifacts.pendingReview(tenantId),
      this.estimates.pending(tenantId),
      this.contracts.unaccepted(tenantId),
      this.clients.stalledProjects(tenantId, stalledDays, agora),
    ]);

    const items: PendingItem[] = [
      ...artefatos.map((a) => ({
        kind: PENDING_KINDS[0],
        clientProjectId: a.clientProjectId,
        title: a.title,
        detail: `Artefato ${a.kind} aguardando revisão`,
        since: a.since,
      })),
      ...estimativas.map((e) => ({
        kind: PENDING_KINDS[1],
        clientProjectId: e.clientProjectId,
        title: e.title,
        detail:
          e.reason === 'missing'
            ? 'Briefing recebido, estimativa não gerada'
            : 'Estimativa gerada, aguardando aprovação',
        since: e.since,
      })),
      ...contratos.map((c) => ({
        kind: PENDING_KINDS[2],
        clientProjectId: c.clientProjectId,
        title: c.title,
        detail: `Contrato v${c.version} emitido, sem aceite registrado`,
        since: c.since,
      })),
      ...parados.map((p) => ({
        kind: PENDING_KINDS[3],
        clientProjectId: p.clientProjectId,
        title: p.title,
        detail: `Parado há mais de ${stalledDays} dias`,
        since: p.since,
      })),
    ];

    return items;
  }

  /**
   * O contador do menu (§2.3, §6).
   *
   * **Chama `pending` e conta** — não reimplementa a soma. É o que torna
   * impossível o número do menu divergir da lista da tela: um contador que
   * contasse por conta própria divergiria na primeira regra que mudasse só de um
   * lado, e o §5 exige teste comparando os dois pelo mesmo caminho de dado.
   *
   * Rota separada porque é chamado a cada navegação e não deve arrastar o
   * dashboard inteiro junto — mas o **caminho de dado é o mesmo**.
   */
  async pendingCount(tenantId: string, agora: Date): Promise<{ count: number }> {
    const items = await this.pending(tenantId, agora);
    return { count: items.length };
  }

  /**
   * *"O que andou por aqui"* — as três trilhas que já existem, sem criar
   * rastreamento novo (§2.2).
   *
   * Sem trilha nenhuma, devolve lista vazia e a **tela mostra texto**, não uma
   * lista em branco (§2.7, §5).
   */
  private async activityFeed(tenantId: string, desde: Date): Promise<ActivityFeedEntry[]> {
    const [funil, auditoria, syncs] = await Promise.all([
      this.clients.recentTransitions(tenantId, desde, ACTIVITY_LIMIT),
      this.activity.recentAudit(tenantId, desde, ACTIVITY_LIMIT),
      this.activity.recentSyncs(tenantId, desde, ACTIVITY_LIMIT),
    ]);

    const doTenant = (e: TenantActivityEntry): ActivityFeedEntry => ({
      kind: e.kind,
      at: e.at,
      title: '',
      detail: e.detail,
      clientProjectId: null,
    });

    return [
      ...funil.map((f) => ({
        kind: f.kind,
        at: f.at,
        title: f.title,
        detail: f.detail,
        clientProjectId: f.clientProjectId,
      })),
      ...auditoria.map(doTenant),
      ...syncs.map(doTenant),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, ACTIVITY_LIMIT);
  }
}
