import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceError,
  GithubSourceClient,
} from '../infrastructure/github-source.client';

/** O que a revogação fez com o acesso ao repo. Devolvido ao chamador e ao log. */
export type RevokeOutcome =
  /** Convite pendente cancelado (`DELETE /invitations/:id`). */
  | 'invitation_canceled'
  /** Colaborador aceito removido (`DELETE /collaborators/:username`). */
  | 'collaborator_removed'
  /** Não havia acesso a desfazer — `NONE`, `PENDING` ou já `REMOVED`. */
  | 'nothing_to_do'
  /** O GitHub falhou; a licença ficou `FAILED` e o admin pode retentar. */
  | 'failed';

/**
 * O fim do acesso ao repo privado (SPEC-039 §Revogação).
 *
 * ## A decisão desta fatia inteira mora aqui: qual chamada desfaz o acesso
 *
 * São **duas**, e não são intercambiáveis:
 *
 * - **`INVITED`** → o convite existe e não foi aceito. Cancela-se a *invitation*
 *   pelo `githubInvitationId`.
 * - **`ACTIVE`** → o convite foi aceito e há assento de colaborador. Remove-se o
 *   colaborador pelo username.
 *
 * **Chamar a errada é no-op silencioso**: a API do GitHub responde sem erro nos
 * dois sentidos — `DELETE /collaborators` devolve `204` para quem nunca foi
 * colaborador, e o convite pendente continua de pé, esperando ser aceito. Nada
 * aparece em log, ninguém é notificado, e o comprador reembolsado fica com acesso
 * ao código-fonte. Foi exatamente por não distinguir esses dois estados que o
 * `sourceInvited: Boolean` da SPEC-036 foi removido no PR-1 desta fatia.
 *
 * ## O que a remoção entrega — e o que não entrega
 *
 * **Não recupera o que já foi clonado** (§Objetivo da spec). O que acaba são os
 * *updates*, que é o mecanismo real do produto (§8 do MVP4: o clone roda sem DRM,
 * o mecanismo é contratual). Painel que sugira "acesso revogado = código
 * recuperado" mente para o operador — por isso o desfecho devolvido nomeia a
 * chamada feita, não um "acesso recuperado" que não existe.
 *
 * ## Falha é visível e retentável, nunca silenciosa
 *
 * *"Reembolsado que continua colaborador"* é a falha que custa dinheiro. Ela não
 * pode viver só no log, onde ninguém olha sem motivo: vai para
 * `sourceAccess = FAILED` + `sourceAccessError` legível, que é o que a lista de
 * pendências do admin exibe (PR-5).
 *
 * **E `FAILED` preserva o que a retentativa precisa saber.** `githubUsername` e
 * `githubInvitationId` ficam intactos — sem eles, a retentativa não teria como
 * saber qual das duas chamadas fazer, e o `FAILED` seria um beco.
 */
@Injectable()
export class SourceRevokeService {
  private readonly logger = new Logger(SourceRevokeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubSourceClient,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Desfaz o acesso ao repo de uma licença. Chamada **já dentro** do contexto de
   * tenant — sem ele, a leitura devolveria zero linhas em silêncio e a revogação
   * viraria um `nothing_to_do` falso.
   *
   * **Idempotente**: rodar duas vezes não erra. A segunda passada encontra
   * `REMOVED` e devolve `nothing_to_do` sem falar com o GitHub.
   *
   * `motivo` entra na trilha (`source_access_removed`) — é o que distingue
   * reembolso de chargeback e de revogação manual do admin.
   */
  async revoke(tenantId: string, licenseId: string, motivo: string): Promise<RevokeOutcome> {
    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: {
        id: true,
        sourceAccess: true,
        githubUsername: true,
        githubInvitationId: true,
      },
    });

    if (!licenca) {
      // Não lança: quem chama é o processamento do webhook, e derrubar o
      // reembolso inteiro porque a licença não foi encontrada trocaria um
      // problema pequeno por um grande. O `status = REVOKED` já foi gravado.
      this.logger.warn(`Licença ${licenseId} não encontrada — nada a revogar no GitHub`);
      return 'nothing_to_do';
    }

    // `NONE`/`PENDING`/`REMOVED` não têm acesso no GitHub para desfazer.
    //
    // `PENDING` é o caso do reembolso ANTES do 8º dia: o convite nunca saiu, e
    // quem limpa o agendamento é o `webhook-processor` (`PENDING → NONE` +
    // `sourceInviteAt = null`), comportamento já definido na SPEC-038. Aqui só se
    // confirma que não há chamada a fazer.
    //
    // `FAILED` NÃO entra nesta lista: é justamente o estado que precisa de nova
    // tentativa. O que decide a chamada, nesse caso, é o `githubInvitationId`.
    if (
      licenca.sourceAccess === 'NONE' ||
      licenca.sourceAccess === 'PENDING' ||
      licenca.sourceAccess === 'REMOVED'
    ) {
      this.logger.log(
        `Licença ${licenseId}: sourceAccess=${licenca.sourceAccess} — nada a remover no GitHub`,
      );
      return 'nothing_to_do';
    }

    if (!licenca.githubUsername) {
      // Estado incoerente (`INVITED`/`ACTIVE` sem username) — não deveria existir,
      // porque o job só promove licença com username. Vira pendência visível em
      // vez de exceção: o admin corrige o username e retenta.
      return this.marcarFalha(
        licenseId,
        'licença sem username do GitHub — impossível remover o acesso',
      );
    }

    const config = await this.configuracao(tenantId);
    if (!config) {
      // Sem PAT não há como remover, e **isto não pode passar como sucesso**: o
      // reembolsado continua com acesso. Diferente do job de convite (onde a
      // ausência de PAT é só pendência de configuração), aqui o silêncio custa
      // dinheiro — então a licença vai para `FAILED` com o motivo.
      return this.marcarFalha(
        licenseId,
        'PAT do GitHub não configurado ou ilegível — acesso ao repo NÃO foi removido',
      );
    }

    try {
      const desfecho = await this.desfazer(config, licenca);

      await this.prisma.license.update({
        where: { id: licenseId },
        data: {
          sourceAccess: 'REMOVED',
          sourceAccessError: null,
          // **`githubInvitationId` é limpo, `githubUsername` NÃO.** O id aponta
          // para uma invitation que já não existe, e mantê-lo faria uma
          // retentativa futura cancelar um convite inexistente em vez de remover
          // o colaborador de uma recompra. O username fica: é a trilha de quem
          // teve acesso, e a exclusão a pedido (LGPD, §7 do MVP4) é que o apaga.
          githubInvitationId: null,
          events: {
            create: {
              tenantId,
              type: 'source_access_removed',
              payload: {
                username: licenca.githubUsername,
                motivo,
                // Qual das duas chamadas foi feita. É o que permite auditar, meses
                // depois, se o acesso morreu pelo caminho certo.
                via: desfecho,
              },
            },
          },
        },
      });

      this.logger.log(
        `Licença ${licenseId}: acesso ao source removido (${desfecho}) por ${motivo}`,
      );
      return desfecho;
    } catch (erro) {
      // **Só mensagem CURADA chega ao banco** — `sourceAccessError` é exibido na
      // tela do admin, e a mensagem de um erro qualquer de `fetch` pode arrastar
      // o header `Authorization` inteiro, entregando `administration:write` no
      // repositório privado a quem abrir a página de pendências. Mesmo tratamento
      // do `SourceInviteService`.
      const mensagem =
        erro instanceof GithubSourceError
          ? erro.message
          : 'falha ao falar com o GitHub — ver o log do servidor';

      if (!(erro instanceof GithubSourceError)) {
        // O detalhe fica no log, com o `Bearer` redigido: log não é superfície
        // pública, mas também não é lugar de segredo.
        const detalhe = (erro instanceof Error ? erro.message : String(erro)).replace(
          /Bearer\s+\S+/gi,
          'Bearer [redigido]',
        );
        this.logger.error(`Licença ${licenseId}: erro inesperado ao remover acesso — ${detalhe}`);
      }

      return this.marcarFalha(licenseId, mensagem);
    }
  }

  /**
   * A escolha da chamada, pelo estado. **O núcleo do PR-4.**
   *
   * `INVITED` **com** id → cancela a invitation. `ACTIVE`, ou `INVITED`/`FAILED`
   * sem id → remove o colaborador.
   *
   * **Por que o fallback é `removeCollaborator` e não o contrário:** sem
   * `githubInvitationId` (o `201` do GitHub veio sem `id`, ou a licença veio de
   * `FAILED`), não há o que cancelar — `cancelInvitation` exige o id. E
   * `removeCollaborator` é seguro no estado errado: devolve `204` para quem não é
   * colaborador. O inverso não vale, e é por isso que a ordem é esta.
   */
  private async desfazer(
    config: SourceConfig,
    licenca: { sourceAccess: string; githubUsername: string | null; githubInvitationId: string | null },
  ): Promise<'invitation_canceled' | 'collaborator_removed'> {
    const username = licenca.githubUsername as string;

    if (licenca.sourceAccess === 'INVITED' && licenca.githubInvitationId) {
      await this.github.cancelInvitation(config.pat, config.repo, licenca.githubInvitationId);
      return 'invitation_canceled';
    }

    await this.github.removeCollaborator(config.pat, config.repo, username);
    return 'collaborator_removed';
  }

  /**
   * `FAILED` + motivo legível, para a lista de pendências do admin.
   *
   * **`githubUsername` e `githubInvitationId` sobrevivem** — são o que a
   * retentativa usa para escolher a chamada. Limpá-los aqui faria o `FAILED`
   * virar um beco: visível, e sem informação para resolver.
   */
  private async marcarFalha(licenseId: string, mensagem: string): Promise<'failed'> {
    await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        sourceAccess: 'FAILED',
        sourceAccessError: mensagem.slice(0, 300),
      },
    });

    this.logger.warn(`Licença ${licenseId}: acesso ao source NÃO removido — ${mensagem}`);
    return 'failed';
  }

  /**
   * PAT (descriptografado) + repo do produto. `null` quando falta qualquer um.
   *
   * Mesma leitura do `SourceInviteService`, e deliberadamente **duplicada em vez
   * de extraída**: são três linhas de consulta, e o que um helper compartilhado
   * economizaria não paga o acoplamento entre o job de convite e o caminho de
   * revogação — que falham por motivos diferentes e tratam a ausência de PAT de
   * formas opostas (lá é pendência de configuração, aqui é `FAILED`).
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
      // Cifra ilegível (chave trocada, valor corrompido). O log NÃO ecoa o valor:
      // ele é, por definição, o segredo.
      this.logger.error(`Tenant ${tenantId}: PAT de source ilegível`);
      return null;
    }

    return { pat, repo: produto.sourceRepo };
  }
}

interface SourceConfig {
  /** Em claro. Existe em memória durante a chamada e não é registrado. */
  pat: string;
  /** `owner/name`. */
  repo: string;
}
