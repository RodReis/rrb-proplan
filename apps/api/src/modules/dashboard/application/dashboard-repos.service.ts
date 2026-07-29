import { Injectable, Logger } from '@nestjs/common';
import {
  BoardSummaryService,
  type RepoAlvo,
} from '../../board/application/board-summary.service';
import {
  MAX_REPOS_POR_CARGA,
  TIMEOUT_POR_REPO_MS,
  classificarFalha,
  type RepoBoardResult,
  type ReposBlock,
} from '../domain/repos';

/**
 * O bloco de repos ao vivo (SPEC-035 §2.6, §2.11, §7.2).
 *
 * ## Rota própria, e a separação é a garantia
 *
 * Vive fora do `GET /dashboard` de propósito (§6): a falha deste bloco **não
 * pode contaminar a resposta principal**. Separar os caminhos torna isso
 * estrutural em vez de um `try/catch` que alguém pode remover sem perceber.
 *
 * ## As quatro salvaguardas, todas obrigatórias (§2.11)
 *
 * 1. **Falha isolada** — erro ou timeout num repo não derruba a tela; o bloco
 *    **nomeia** o repo e o resto renderiza.
 * 2. **Timeout curto por repo**, e chamadas **em paralelo**.
 * 3. **Teto de repos por carga**, com o excedente sob *"ver todos"*.
 * 4. **Degradação explícita no rate limit** — nunca zero silencioso, que seria
 *    indistinguível de board vazio.
 *
 * Elas **contêm** o dano; não eliminam a dependência de um terceiro no caminho
 * de abertura da tela (§7.2). O gatilho de revisão está lá: rate limit
 * recorrente ou abertura degradando → volta ao PI com *"ao vivo sob clique"*,
 * nunca cache silencioso, que colidiria com o ADR-017.
 *
 * **Nada é gravado.** O §5 cobra por ausência, e o `dashboard.arch.spec.ts` a
 * prova.
 */
@Injectable()
export class DashboardReposService {
  private readonly logger = new Logger(DashboardReposService.name);

  constructor(private readonly board: BoardSummaryService) {}

  async block(tenantId: string): Promise<ReposBlock> {
    const todos = await this.board.reposDoTenant(tenantId);

    // Teto: os N mais recentes. O excedente **não é consultado** — é o ponto da
    // salvaguarda 3, e o número dele viaja para a tela poder dizer "+7 em ver
    // todos". Lista curta sem o número leria como "são só estes".
    const consultados = todos.slice(0, MAX_REPOS_POR_CARGA);
    const notLoaded = todos.length - consultados.length;

    // `Promise.all` sobre resultados JÁ resolvidos: cada `lerUm` captura a
    // própria falha, então nenhuma rejeição escapa e o `all` nunca curto-circuita
    // — que é exatamente a salvaguarda 1. Paralelo é a salvaguarda 2: N repos
    // custam o tempo do mais lento, não a soma.
    const repos = await Promise.all(consultados.map((alvo) => this.lerUm(alvo)));

    return { repos, notLoaded };
  }

  /**
   * Lê um repo, **sem deixar a falha escapar**.
   *
   * O timeout é aplicado aqui e não dentro do client: o client tem o dele
   * (10 s, dimensionado para o sync), e este bloco precisa de um **mais curto**
   * — a tela abre sem o bloco, não depois dele.
   */
  private async lerUm(alvo: RepoAlvo): Promise<RepoBoardResult> {
    const repo = `${alvo.owner}/${alvo.name}`;
    try {
      const columns = await comTimeout(
        this.board.contagemAoVivo(alvo),
        TIMEOUT_POR_REPO_MS,
      );
      return { status: 'ok', projectId: alvo.projectId, repo, columns };
    } catch (err) {
      const { reason, retryAt } = classificarFalha(err);
      // `warn` e não `error`: repo indisponível é estado esperado desta tela,
      // não incidente. Enche o log de alarme falso e ninguém olha os de verdade.
      this.logger.warn(`Dashboard: ${repo} não pôde ser lido (${reason})`);
      return { status: 'failed', projectId: alvo.projectId, repo, reason, retryAt };
    }
  }
}

/**
 * Corre a promessa contra um relógio.
 *
 * A promessa perdedora continua rodando — não há como cancelá-la daqui, e
 * fingir o contrário seria pior. O que este limite garante é que **a tela não
 * espera por ela**, que é o que a salvaguarda 2 pede.
 */
function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const erro = new Error(`timeout de ${ms}ms`);
      erro.name = 'TimeoutError';
      reject(erro);
    }, ms);
    promessa.then(
      (valor) => {
        clearTimeout(timer);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(timer);
        reject(erro);
      },
    );
  });
}
