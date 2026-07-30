import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceError,
  GithubSourceClient,
} from '../infrastructure/github-source.client';

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
 * ## Sem agendador, e isso é deliberado
 *
 * Não há `@nestjs/schedule` nem `repeat` de BullMQ no repo, e a spec diz "job
 * diário" sem dizer como dispara. Escolher isso é decisão de infra, não minha —
 * o mesmo tratamento que o job de `EXPIRED` da SPEC-038 recebeu. O que existe
 * aqui é um método **chamável**: testável, e disparável pelo admin (PR-5).
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
  ) {}

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
