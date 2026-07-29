import { Injectable } from '@nestjs/common';
import { ClientProjectState } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { COLUMN_OF, FUNNEL_COLUMNS, type FunnelColumn } from '../domain/funnel';

export interface FunnelColumnCount {
  column: FunnelColumn;
  count: number;
}

export interface StalledProject {
  clientProjectId: string;
  /** Cliente dono — o drill-down do dashboard abre a gaveta dele (§7.3). */
  clientId: string;
  title: string;
  state: ClientProjectState;
  clientName: string;
  /** Desde quando parado — ISO, para a tela formatar. */
  since: string;
}

export interface ActivityEntry {
  kind: 'funnel';
  at: string;
  clientProjectId: string;
  title: string;
  detail: string;
}

/**
 * A superfície pública que o `dashboard` consome do `clients` (SPEC-035 §2.1).
 *
 * ## Por que um service novo, e não mais métodos no `ClientsService`
 *
 * Tudo o que o `ClientsService` expõe é **por projeto** — `getBoard`,
 * `getProject`, `getHistory` recebem um id e devolvem um card. O dashboard
 * precisa de **contagem por tenant**, que é uma pergunta diferente.
 *
 * A alternativa seria o agregador consultar `client_projects` direto. É
 * exatamente o que o `dashboard.arch.spec.ts` quebra o build para impedir: o
 * `PrismaService` é global, então nada barra tecnicamente o import — a fronteira
 * do ADR-001 é decisão, não impedimento (mesmo argumento do
 * `estimates-boundaries.arch.spec.ts`).
 *
 * **Só leitura.** Nada aqui escreve, e o dashboard inteiro não guarda nada
 * (§2, §3).
 *
 * Todo método recebe `tenantId` do `TenantGuard` e roda sob o `withTenant` que
 * o `TenantContextInterceptor` já abriu — nenhum abre contexto próprio, como no
 * resto do módulo.
 */
@Injectable()
export class ClientsSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Contagem por coluna do funil, no período.
   *
   * Devolve as **4 colunas sempre**, inclusive as vazias: coluna ausente da
   * resposta faria a tela mostrar duas e a pessoa concluir que as outras não
   * existem. Ausência e zero são coisas diferentes (§2.7).
   */
  async funnel(tenantId: string, desde: Date): Promise<FunnelColumnCount[]> {
    const linhas = await this.prisma.clientProject.groupBy({
      by: ['state'],
      where: {
        deletedAt: null,
        client: { tenantId, deletedAt: null },
        createdAt: { gte: desde },
      },
      _count: { _all: true },
    });

    const porColuna = new Map<FunnelColumn, number>(
      FUNNEL_COLUMNS.map((coluna) => [coluna, 0]),
    );
    for (const linha of linhas) {
      const coluna = COLUMN_OF[linha.state];
      porColuna.set(coluna, (porColuna.get(coluna) ?? 0) + linha._count._all);
    }

    return FUNNEL_COLUMNS.map((column) => ({ column, count: porColuna.get(column) ?? 0 }));
  }

  /**
   * O tenant já cadastrou algum cliente?
   *
   * Separado da contagem de propósito — é o que distingue *"0 no período"* de
   * *"você ainda não começou"* (§2.7). `COUNT(*)` devolve `0` para os dois, e
   * colapsá-los faz *nunca usei* parecer *usei e deu zero*, que o §5 nomeia como
   * o defeito mais provável desta tela.
   */
  async hasAnyClient(tenantId: string): Promise<boolean> {
    const total = await this.prisma.client.count({
      where: { tenantId, deletedAt: null },
    });
    return total > 0;
  }

  /**
   * Projetos parados há mais que o limite — 4º item de *Esperando você* (§2.3).
   *
   * ## "Parado" é medido pela última TRANSIÇÃO, não pelo `updatedAt` da linha
   *
   * A fonte que o §6 nomeia é *"`client_projects` cuja última
   * `client_status_transition` é anterior ao limite"*, e a diferença não é
   * detalhe: `updatedAt` do Prisma muda a **qualquer** escrita na linha —
   * corrigir uma vírgula no título tiraria da lista um projeto travado há 60
   * dias, sem que nada tivesse andado. *Parado* é uma afirmação sobre o
   * **funil**, não sobre a linha do banco.
   *
   * **Projeto sem transição nenhuma conta desde a criação.** Card criado e
   * nunca movido é o caso mais parado que existe; exigir uma transição para
   * entrar na lista esconderia exatamente quem nunca andou.
   *
   * O corte acontece em memória porque depende da **última** transição de cada
   * projeto — um `where` sobre a relação responderia *"tem alguma transição
   * anterior ao limite"*, que é verdade para todo projeto antigo que andou
   * ontem. O universo já vem estreitado por tenant e estado.
   *
   * O limite chega por parâmetro, vindo de `TenantSettings`: o critério de
   * aceite cobra que *"parado"* use o valor configurado e não um `7` literal
   * espalhado pelo código.
   *
   * `DELIVERED` e `ARCHIVED` ficam de fora — parado ali é o fim normal do
   * funil, não algo esperando por alguém.
   */
  async stalledProjects(
    tenantId: string,
    diasLimite: number,
    agora: Date,
  ): Promise<StalledProject[]> {
    const limite = new Date(agora.getTime() - diasLimite * 24 * 60 * 60 * 1000);

    const projetos = await this.prisma.clientProject.findMany({
      where: {
        deletedAt: null,
        client: { tenantId, deletedAt: null },
        state: { notIn: ['DELIVERED', 'ARCHIVED'] },
      },
      include: {
        client: { select: { id: true, name: true, company: true } },
        transitions: { orderBy: { at: 'desc' }, take: 1, select: { at: true } },
      },
    });

    return projetos
      .map((p) => ({
        clientProjectId: p.id,
        clientId: p.client.id,
        title: p.title,
        state: p.state,
        clientName: p.client.name,
        // Sem transição, o relógio corre desde a criação.
        since: (p.transitions[0]?.at ?? p.createdAt).toISOString(),
      }))
      .filter((p) => new Date(p.since) < limite)
      // Mais parado primeiro: quem espera há mais tempo é quem a tela deve
      // mostrar antes de a lista ser truncada por altura.
      .sort((a, b) => a.since.localeCompare(b.since));
  }

  /**
   * Transições recentes do funil — uma das três trilhas de *"O que andou por
   * aqui"* (§2.2).
   *
   * **Sem ator na projeção.** `actorUserId` existe nesta tabela mas não nas
   * outras duas (`audit_events`, `sync_runs`), e o §7.1 resolveu isso rotulando
   * o bloco por **tenant**, não por usuário. Projetar o ator só aqui produziria
   * uma lista em que um terço das linhas tem nome e o resto não — pior que
   * nenhuma ter.
   */
  async recentTransitions(
    tenantId: string,
    desde: Date,
    take: number,
  ): Promise<ActivityEntry[]> {
    const linhas = await this.prisma.clientStatusTransition.findMany({
      where: {
        at: { gte: desde },
        clientProject: { deletedAt: null, client: { tenantId, deletedAt: null } },
      },
      include: {
        clientProject: { select: { title: true, client: { select: { name: true } } } },
      },
      orderBy: { at: 'desc' },
      take,
    });

    return linhas.map((t) => ({
      kind: 'funnel' as const,
      at: t.at.toISOString(),
      clientProjectId: t.clientProjectId,
      title: t.clientProject.title,
      detail: `${t.fromState} → ${t.toState}`,
    }));
  }
}
