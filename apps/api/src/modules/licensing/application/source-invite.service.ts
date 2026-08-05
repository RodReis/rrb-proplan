import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceError,
  GithubSourceClient,
} from '../infrastructure/github-source.client';
import { LICENSING_QUEUE, SOURCE_RECONCILE_JOB } from '../licensing.constants';

/** O que uma rodada de reconciliação fez. Devolvido para o log e para o admin. */
export interface ReconcileResult {
  convidados: number;
  aceitos: number;
  falhas: number;
  /** Licenças com direito a source e sem username — pendência humana, não erro. */
  aguardandoUsername: number;
}

/**
 * O convite ao repo privado (SPEC-039 §Job do convite).
 *
 * ## Reconciliação, não gatilho de data
 *
 * A pergunta que este service faz não é *"quem comprou há exatamente 8 dias?"* —
 * é **"quem tem direito e ainda não tem?"**. A diferença não é estilo: um job
 * disparado por data deixaria órfão, para sempre e em silêncio, o comprador que
 * informou o username no dia 9. E esse é o caso mais provável de todos, porque
 * depende de alguém ler e-mail.
 *
 * Quem responde no dia 20 é convidado no dia 20.
 *
 * ## Idempotente por ESTADO, não por horário
 *
 * A transição `PENDING → INVITED` é a guarda. Rodar duas vezes no mesmo dia, ou
 * reprocessar depois de uma queda, não emite dois convites — porque a segunda
 * rodada não encontra mais a licença em `PENDING`.
 *
 * ## A aceitação é descoberta, não notificada
 *
 * O GitHub **não manda webhook de convite aceito** nesta configuração (repo
 * pessoal). Então `INVITED → ACTIVE` sai de uma pergunta ativa —
 * `GET /collaborators/:username` — feita pela mesma rodada. Sem isso, uma licença
 * aceita ficaria `INVITED` para sempre, e o PR-4 tentaria cancelar uma invitation
 * que já não existe.
 *
 * ## Roda sozinho desde a SPEC-048 — por dois gatilhos, não um
 *
 * Até a Fatia 36 o repo **não tinha agendador**, e o método era só chamável
 * (pelo botão do admin). O ADR-029 criou o mecanismo, e esta fatia ligou os dois
 * caminhos que se cobrem:
 *
 * - **Recorrente diário** (`SourceReconcileScheduler`, 4 h) — a rede de
 *   segurança, e o único caminho que atende o caso mais comum: quem compra e
 *   informa o username no **dia 0** não produz evento nenhum no dia 8, só o
 *   relógio.
 * - **Por evento** (`agendarReconciliacao`, abaixo) — quem responde **depois**
 *   do 8º dia entra em segundos, em vez de esperar até 24 h.
 *
 * **Nenhum dos dois tem consulta própria**: ambos caem no `reconcile`, com o
 * filtro `sourceInviteAt <= agora` intacto. É isso que faz o prazo de 8 dias ser
 * verdade por construção, e não por disciplina de quem chama.
 *
 * **Nada de acesso depende de este job rodar na hora.** Atraso não concede nem
 * revoga nada — só adia um convite. É a mesma regra da validação: o que decide
 * acesso mora na leitura, nunca num job.
 */
@Injectable()
export class SourceInviteService {
  private readonly logger = new Logger(SourceInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubSourceClient,
    private readonly crypto: CryptoService,
    @InjectQueue(LICENSING_QUEUE) private readonly fila: Queue,
  ) {}

  /**
   * Antecipa a rodada porque o username acabou de ser gravado (SPEC-048).
   *
   * Chamado pelos dois caminhos que gravam username — o link público e o admin.
   * Serve a quem responde **depois** do 8º dia: sem isto, o convite esperaria até
   * 24 h pela rodada diária; com isto, sai em segundos. Antes do 8º dia não faz
   * nada visível, porque o filtro `sourceInviteAt <= agora` do `convidarPendentes`
   * não encontra a licença — **é ele a guarda do prazo, e este atalho não a
   * contorna.**
   *
   * ## Nunca lança
   *
   * Esta é a razão de o método existir em vez de um `fila.add` solto nos dois
   * chamadores. Se o Redis estiver fora, o username **tem de ficar gravado assim
   * mesmo** — a rodada diária o pega depois. Propagar a falha transformaria uma
   * indisponibilidade de Redis em *"o comprador não consegue informar o
   * username"*, que é bem pior do que esperar a próxima rodada.
   *
   * ## Não é um segundo agendador
   *
   * É um `add` comum, disparado por ação do usuário — exatamente como o webhook
   * já enfileira o processamento de uma venda. O que o ADR-029 concentra num
   * mecanismo só é *"rode isto de tempos em tempos"*, e isto aqui não diz isso.
   * O `job.name` é o mesmo do recorrente de propósito: o worker roteia para a
   * mesma execução, e não existe um segundo lugar sabendo convidar.
   */
  async agendarReconciliacao(tenantId: string): Promise<void> {
    try {
      await this.fila.add(SOURCE_RECONCILE_JOB, { tenantId });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      this.logger.warn(
        `Não foi possível antecipar a reconciliação do tenant ${tenantId}: ${motivo} ` +
          '— a rodada diária cobre',
      );
    }
  }

  /**
   * Os tenants que a rodada diária varre (SPEC-048).
   *
   * **Não reusa o `tenantsConfigurados` do sync de catálogo**, e a diferença
   * importa nos dois sentidos: aquele filtra credenciais da **Kiwify**, então um
   * tenant com PAT e sem Kiwify seria pulado — e o convite nunca sairia, que é o
   * defeito desta fatia de volta. Na direção oposta, varrer quem tem Kiwify e
   * não tem PAT gastaria uma rodada para o `reconcile` sair na primeira linha.
   *
   * O filtro é **economia, não regra**: quem decide é o `configuracao()` lá
   * dentro, que já devolve `null` sem PAT ou sem produto com `sourceRepo`.
   * Duplicar a decisão aqui criaria dois lugares para acertar a mesma coisa.
   *
   * Atravessa tenants e devolve só ids — a pergunta é *"quais tenants?"*; o
   * `runInTenantContext` entra depois, uma vez por tenant (ADR-029, decisão 4).
   */
  async tenantsComSource(): Promise<string[]> {
    const linhas = await this.prisma.licSettings.findMany({
      where: { githubPat: { not: null } },
      select: { tenantId: true },
    });
    return linhas.map((l) => l.tenantId);
  }

  /**
   * Uma rodada para um tenant. Chamada **já dentro** do contexto de tenant.
   *
   * Duas fases, e a ordem é indiferente — não há dependência entre elas. Primeiro
   * promove quem aceitou (leitura barata), depois convida quem falta.
   */
  async reconcile(tenantId: string): Promise<ReconcileResult> {
    const resultado: ReconcileResult = {
      convidados: 0,
      aceitos: 0,
      falhas: 0,
      aguardandoUsername: 0,
    };

    const config = await this.configuracao(tenantId);
    if (!config) {
      // Sem PAT configurado não há o que fazer, e **isso não é erro do job**: é
      // pendência de configuração, que o admin vê no teste de conexão (PR-5).
      // Marcar as licenças como `FAILED` aqui encheria a lista de pendências de
      // linhas cuja causa é uma só — o token que ninguém cadastrou.
      this.logger.log(`Tenant ${tenantId} sem PAT/repo de source — nada a reconciliar`);
      return resultado;
    }

    await this.promoverAceitos(tenantId, config, resultado);
    await this.convidarPendentes(tenantId, config, resultado);

    return resultado;
  }

  /**
   * `INVITED → ACTIVE` para quem aceitou o convite no GitHub.
   *
   * **Falha aqui não muda estado.** Um `403` do PAT expirado não significa "não
   * aceitou": significa "não deu para saber". Rebaixar para `FAILED` faria a
   * lista de pendências acusar o comprador por um problema do nosso token.
   */
  private async promoverAceitos(
    tenantId: string,
    config: SourceConfig,
    resultado: ReconcileResult,
  ): Promise<void> {
    const convidadas = await this.prisma.license.findMany({
      where: {
        tenantId,
        sourceAccess: 'INVITED',
        githubUsername: { not: null },
        // Licença revogada não é promovida: quem foi reembolsado não ganha
        // `ACTIVE` porque aceitou o convite antes de o PR-4 removê-lo.
        status: 'ACTIVE',
      },
      select: { id: true, githubUsername: true },
    });

    for (const licenca of convidadas) {
      const username = licenca.githubUsername as string;
      try {
        if (!(await this.github.isCollaborator(config.pat, config.repo, username))) {
          continue; // Convite ainda pendente — normal, não é falha.
        }

        await this.prisma.license.update({
          where: { id: licenca.id },
          data: {
            sourceAccess: 'ACTIVE',
            sourceAccessError: null,
            events: {
              create: {
                tenantId,
                type: 'source_invite_accepted',
                payload: { username },
              },
            },
          },
        });
        resultado.aceitos += 1;
        this.logger.log(`Licença ${licenca.id}: convite aceito por ${username}`);
      } catch (erro) {
        // Não mexe no estado: continua `INVITED`, e a próxima rodada tenta de
        // novo. O erro fica visível na pendência sem mentir sobre o acesso.
        resultado.falhas += 1;
        await this.registrarFalha(licenca.id, erro);
      }
    }
  }

  /**
   * `PENDING → INVITED` (ou `ACTIVE`, se já era colaborador).
   *
   * O filtro é a regra da fatia inteira: **direito + prazo + username**. Falta
   * qualquer um e nada acontece — e a ausência de convite é informação, não erro.
   */
  private async convidarPendentes(
    tenantId: string,
    config: SourceConfig,
    resultado: ReconcileResult,
  ): Promise<void> {
    const agora = new Date();

    const pendentes = await this.prisma.license.findMany({
      where: {
        tenantId,
        sourceAccess: 'PENDING',
        status: 'ACTIVE',
        // `<= agora`, não `= hoje`: quem passou do prazo há duas semanas (porque
        // o job não rodou, ou porque o username chegou tarde) entra nesta
        // rodada. É o que faz disto reconciliação.
        sourceInviteAt: { lte: agora },
      },
      select: { id: true, githubUsername: true },
    });

    for (const licenca of pendentes) {
      if (!licenca.githubUsername) {
        // Tem direito e passou do prazo, mas o comprador não informou o username.
        // **Não é falha e não vira `FAILED`**: é pendência humana, e o admin a vê
        // na lista com a ação de corrigir. Marcar erro aqui faria a coluna de
        // falhas contar o silêncio do comprador como defeito nosso.
        resultado.aguardandoUsername += 1;
        continue;
      }

      try {
        const convite = await this.github.invite(
          config.pat,
          config.repo,
          licenca.githubUsername,
        );

        // `204` do GitHub = já era colaborador, nenhum convite emitido. Gravar
        // `INVITED` aqui deixaria a licença esperando para sempre uma aceitação
        // que já aconteceu.
        const jaColaborador = convite.kind === 'already_collaborator';

        await this.prisma.license.update({
          where: { id: licenca.id },
          data: {
            sourceAccess: jaColaborador ? 'ACTIVE' : 'INVITED',
            githubInvitationId: jaColaborador ? null : convite.invitationId,
            sourceAccessError: null,
            events: {
              create: {
                tenantId,
                type: jaColaborador ? 'source_invite_accepted' : 'source_invited',
                payload: {
                  username: licenca.githubUsername,
                  repo: config.repo,
                  ...(jaColaborador ? { alreadyCollaborator: true } : {}),
                },
              },
            },
          },
        });

        resultado.convidados += 1;
        this.logger.log(
          `Licença ${licenca.id}: ${jaColaborador ? 'já era colaborador' : 'convidado'} ` +
            `(${licenca.githubUsername})`,
        );
      } catch (erro) {
        resultado.falhas += 1;
        await this.registrarFalha(licenca.id, erro, 'FAILED');
      }
    }
  }

  /**
   * Erro legível na licença, para a lista de pendências do admin.
   *
   * **`FAILED` só na fase de convite.** Na promoção o estado fica `INVITED` — ver
   * `promoverAceitos`. E a licença nunca é tocada além disto: *"reembolsado que
   * continua colaborador"* é a falha que custa dinheiro, e ela não pode viver só
   * no log, onde ninguém olha sem motivo.
   */
  private async registrarFalha(
    licenseId: string,
    erro: unknown,
    estado?: 'FAILED',
  ): Promise<void> {
    // **Só mensagem CURADA chega ao banco** — e isto foi um defeito real, pego
    // por teste: `sourceAccessError` é exibido na tela do admin, e a mensagem de
    // um erro qualquer de `fetch` pode arrastar o header `Authorization` inteiro.
    // Publicar isso entregaria `administration:write` no repositório privado a
    // quem abrir a página de pendências.
    //
    // `GithubSourceError` é construído por nós, a partir do status (ver `motivo`)
    // — nunca do corpo nem dos headers da resposta. Qualquer outro erro vira
    // texto fixo: o detalhe vai para o log do servidor, que não é uma superfície
    // pública.
    const mensagem =
      erro instanceof GithubSourceError
        ? erro.message
        : 'falha ao falar com o GitHub — ver o log do servidor';

    if (!(erro instanceof GithubSourceError)) {
      // O detalhe fica no log — **com o `Bearer` redigido**. Log não é superfície
      // pública, mas também não é lugar de segredo: quem lê log de produção não
      // deveria sair dele com um token de escrita em repositório privado. Mesmo
      // princípio do `licensing-boundaries.arch.spec.ts`, que proíbe a chave de
      // licença em `logger.*`.
      const detalhe = (erro instanceof Error ? erro.message : String(erro)).replace(
        /Bearer\s+\S+/gi,
        'Bearer [redigido]',
      );
      this.logger.warn(`Licença ${licenseId}: erro inesperado do GitHub — ${detalhe}`);
    }

    await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        ...(estado ? { sourceAccess: estado } : {}),
        sourceAccessError: mensagem.slice(0, 300),
      },
    });

    this.logger.warn(`Licença ${licenseId}: ${mensagem}`);
  }

  /**
   * PAT (descriptografado) + repo do produto.
   *
   * `null` quando falta qualquer um dos dois — e faltar é o estado normal antes
   * de o operador configurar, não uma anomalia.
   *
   * **O produto vem por tenant, não por licença**: o piloto tem um produto com
   * source, e ler o repo de cada licença faria N consultas para o mesmo valor. Se
   * um dia houver dois produtos com source no mesmo tenant, isto passa a resolver
   * por licença — e o teste que ancora a decisão está no spec.
   */
  private async configuracao(tenantId: string): Promise<SourceConfig | null> {
    const settings = await this.prisma.licSettings.findFirst({
      where: { tenantId },
      select: { githubPat: true },
    });
    if (!settings?.githubPat) return null;

    const produto = await this.prisma.licProduct.findFirst({
      where: { tenantId, sourceRepo: { not: null } },
      select: { sourceRepo: true },
    });
    if (!produto?.sourceRepo) return null;

    let pat: string;
    try {
      pat = this.crypto.decrypt(settings.githubPat);
    } catch {
      // Cifra ilegível (chave trocada, valor corrompido). Sem o PAT não há
      // convite — e o log NÃO ecoa o valor: ele é, por definição, o segredo.
      this.logger.error(`Tenant ${tenantId}: PAT de source ilegível`);
      return null;
    }

    return { pat, repo: produto.sourceRepo };
  }
}

interface SourceConfig {
  /** Em claro. Existe em memória durante a rodada e não é registrado. */
  pat: string;
  /** `owner/name`. */
  repo: string;
}
