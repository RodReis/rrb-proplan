import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import { COLUMNS, columnOf, isEpic } from '../domain/column-mapping';
import { GithubIssuesClient } from '../infrastructure/github-issues.client';

export interface RepoAlvo {
  projectId: string;
  owner: string;
  name: string;
  userId: string;
}

export interface ContagemPorColuna {
  column: string;
  count: number;
}

/**
 * O bloco de repos do dashboard, lido **ao vivo** (SPEC-035 §2.6, ADR-017).
 *
 * ## Por que não reusar `BoardService.getBoard`
 *
 * O `getBoard` lê o **cache** (`prisma.issue`), preenchido pelo `syncIssues`. A
 * spec pede ao vivo *"nada persistido"* — então este caminho vai ao GitHub e
 * **não grava nada**. As duas leituras convivem: o board do workspace continua
 * servindo do cache (é interativo, tem drag-and-drop e precisa responder rápido);
 * o dashboard mostra a contagem do momento.
 *
 * ## A regra de coluna NÃO é reimplementada aqui
 *
 * `columnOf` e `isEpic` vêm do `domain/` do próprio módulo. Recontar coluna por
 * conta própria produziria um dashboard que discorda do board na mesma tela —
 * e quem estivesse olhando não teria como saber qual dos dois mente.
 *
 * ## Só leitura, e o custo é conhecido
 *
 * N chamadas ao GitHub por carga, no mesmo rate limit do catálogo e do sync
 * (§7.2). O teto, o timeout e o paralelismo vivem no `DashboardReposService`,
 * que orquestra; aqui mora **uma leitura de um repo**.
 */
@Injectable()
export class BoardSummaryService {
  private readonly logger = new Logger(BoardSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly issues: GithubIssuesClient,
  ) {}

  /**
   * Projetos do tenant que podem ser consultados, **mais ativos primeiro**.
   *
   * A ordem importa porque existe teto (§2.11): quando o excedente cai sob *"ver
   * todos"*, quem fica de fora tem de ser o repo parado, não o que teve commit
   * ontem. `lastCodeCommitAt` é a melhor proxy que existe hoje — e os `null`
   * (repo nunca sincronizado) vão para o fim, que é onde devem estar.
   *
   * **Só instalação ativa.** Repo sem o App instalado não tem token que o leia
   * (ADR-015), e incluí-lo produziria uma falha garantida por carga — ruído que
   * nada resolve, ocupando uma das vagas do teto.
   */
  async reposDoTenant(tenantId: string): Promise<RepoAlvo[]> {
    const projetos = await this.prisma.project.findMany({
      where: { tenantId, installationStatus: 'active' },
      select: { id: true, owner: true, name: true, userId: true },
      orderBy: [{ lastCodeCommitAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    });
    return projetos.map((p) => ({
      projectId: p.id,
      owner: p.owner,
      name: p.name,
      userId: p.userId,
    }));
  }

  /**
   * Contagem por coluna de **um** repo, ao vivo.
   *
   * Devolve as 6 colunas **sempre**, inclusive as vazias — coluna ausente faria
   * a tela mostrar menos colunas para um repo que para outro, e a pessoa leria
   * como se aquele board fosse diferente.
   *
   * **Épico não é card** (SPEC-024): sai da contagem, como sai do board. Contá-lo
   * inflaria a coluna com uma faixa, e os dois números divergiriam.
   *
   * Erro **sobe** — quem decide o que fazer com ele é o orquestrador, que sabe
   * que a falha de um repo não pode derrubar os outros (§2.11).
   */
  async contagemAoVivo(alvo: RepoAlvo): Promise<ContagemPorColuna[]> {
    const token = await this.auth.userToken(alvo.userId);
    // `listIssuesWithHierarchy` e não `listIssues`: é o mesmo caminho que o
    // `syncIssues` usa, e é o que traz `hasSubIssues`. Sem ele, épico entraria
    // na contagem como card e o dashboard mostraria um número maior que o
    // board — na mesma tela, sem ninguém poder saber qual dos dois mente.
    const remotas = await this.issues.listIssuesWithHierarchy(token, alvo.owner, alvo.name);

    const porColuna = new Map<string, number>(COLUMNS.map((c) => [c, 0]));
    for (const issue of remotas) {
      // Épico é faixa, não card (SPEC-024) — sai da contagem como sai do board.
      if (isEpic(issue.hasSubIssues ?? false)) continue;
      const labels = issue.labels.map((l) => l.name);
      const coluna = columnOf(issue.state, labels);
      porColuna.set(coluna, (porColuna.get(coluna) ?? 0) + 1);
    }

    return COLUMNS.map((column) => ({ column, count: porColuna.get(column) ?? 0 }));
  }
}
