import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import { isValidGithubUsername } from '../domain/source-token';
import { GithubSourceClient } from '../infrastructure/github-source.client';
import { SourceInviteService, type ReconcileResult } from './source-invite.service';
import { SourceRevokeService, type RevokeOutcome } from './source-revoke.service';

/**
 * Admin do acesso ao repo source (SPEC-039 PR-5) — o **mínimo** que tira a
 * pendência do beco.
 *
 * ## O que existe para destravar
 *
 * Os PRs 3 e 4 gravam três estados que **pedem gente**, e nenhum deles se resolve
 * sozinho:
 *
 * | estado | o que aconteceu | o que o admin faz |
 * |---|---|---|
 * | `PENDING` sem `githubUsername`, prazo vencido | o comprador não respondeu ao e-mail | grava o username por ele |
 * | `INVITED` há muito tempo | o convite saiu e não foi aceito | reemite, ou remove |
 * | `FAILED` | o GitHub recusou (PAT expirado, 403, rede) | conserta a causa e retenta |
 *
 * Sem estas rotas, os três são informação no banco que ninguém alcança — o mesmo
 * beco que o `LicensingOpsService` tirou do webhook na SPEC-038. E aqui o beco é
 * mais caro: a edição com código-fonte é a mais cara do catálogo, e *"comprou e
 * não recebeu"* vira ticket com o cliente já pago.
 *
 * ## `githubPat` é write-only, e o teste de conexão é o que o torna operável
 *
 * O `GET` devolve **se está configurado**, nunca o valor — mesmo princípio do
 * `webhookSecret`. Mas há uma diferença que muda o desenho: o segredo do webhook
 * é gerado pela Kiwify e não expira; o **PAT fine-grained expira** (limite do
 * GitHub, não escolha nossa).
 *
 * Uma expiração silenciosa pararia os convites **sem nenhum erro visível** — o job
 * roda, falha em cada licença, e o comprador espera. É por isso que o par *teste
 * de conexão* + *pendência `FAILED`* existe: um antecipa, o outro acusa. A
 * primeira venda não é o lugar de descobrir que o token está errado.
 *
 * ## O PAT é cifrado; o `webhookSecret` não é
 *
 * E a diferença não é inconsistência. O `webhookSecret` é comparado por HMAC a
 * cada entrega — precisa estar legível no caminho da request. O PAT **concede
 * escrita num repositório privado**: cifrá-lo com o `TOKEN_ENCRYPTION_KEY` que já
 * existe (decisão PI #2) faz um dump do banco não virar acesso ao código-fonte.
 */

/** Uma licença que precisa de gente. `motivo` é o que a tela agrupa. */
export interface SourcePendingItem {
  licenseId: string;
  customerEmail: string;
  customerName: string | null;
  editionName: string;
  sourceAccess: string;
  githubUsername: string | null;
  sourceInviteAt: Date | null;
  sourceAccessError: string | null;
  /** Por que está na lista — decidido no servidor, não na tela. */
  reason: 'awaiting_username' | 'invited_not_accepted' | 'failed';
}

export interface SourceSettingsView {
  /** `true` quando há PAT gravado. O valor **nunca** sai. */
  githubPatSet: boolean;
  /** `owner/name` do produto que concede source, ou `null` se não configurado. */
  sourceRepo: string | null;
}

/** O que o teste de conexão descobriu. `ok: false` sempre traz o motivo. */
export type ConnectionTest =
  | { ok: true; repo: string }
  | { ok: false; reason: string };

@Injectable()
export class SourceAdminService {
  private readonly logger = new Logger(SourceAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubSourceClient,
    private readonly crypto: CryptoService,
    private readonly invites: SourceInviteService,
    private readonly revokes: SourceRevokeService,
  ) {}

  /**
   * As licenças que pedem ação (§Fora de escopo: *"aqui, o mínimo"*).
   *
   * **Três motivos, e a tela não os deduz.** Quem classifica é o servidor, que é
   * onde a regra mora: `PENDING` com prazo vencido e sem username é *"aguardando o
   * comprador"*; `INVITED` é *"convite não aceito"*; `FAILED` é *"deu erro"*. Uma
   * tela que inferisse isso do enum duplicaria a regra, e as duas divergiriam na
   * primeira mudança.
   *
   * **`PENDING` com prazo NÃO vencido fica fora, de propósito.** Quem comprou hoje
   * está no prazo legal de arrependimento — não é pendência, é o processo
   * andando. Incluí-lo encheria a lista de linhas que não têm o que fazer, e a
   * lista perderia o significado de *"aqui há trabalho"*.
   */
  async pending(tenantId: string): Promise<SourcePendingItem[]> {
    const agora = new Date();

    const licencas = await this.prisma.license.findMany({
      where: {
        tenantId,
        OR: [
          // Prazo vencido e o comprador não informou o username. `lte: agora`
          // pelo mesmo motivo do job: quem venceu há duas semanas continua
          // pendente, não desaparece.
          {
            sourceAccess: 'PENDING',
            githubUsername: null,
            sourceInviteAt: { lte: agora },
          },
          { sourceAccess: 'INVITED' },
          { sourceAccess: 'FAILED' },
        ],
      },
      select: {
        id: true,
        customerEmail: true,
        customerName: true,
        sourceAccess: true,
        githubUsername: true,
        sourceInviteAt: true,
        sourceAccessError: true,
        edition: { select: { name: true } },
      },
      orderBy: { sourceInviteAt: 'asc' },
    });

    return licencas.map((l) => ({
      licenseId: l.id,
      customerEmail: l.customerEmail,
      customerName: l.customerName,
      editionName: l.edition.name,
      sourceAccess: l.sourceAccess,
      githubUsername: l.githubUsername,
      sourceInviteAt: l.sourceInviteAt,
      sourceAccessError: l.sourceAccessError,
      reason:
        l.sourceAccess === 'FAILED'
          ? 'failed'
          : l.sourceAccess === 'INVITED'
            ? 'invited_not_accepted'
            : 'awaiting_username',
    }));
  }

  /**
   * Grava ou substitui o username (decisão PI #4: **só pelo admin**).
   *
   * *"Nenhum caminho self-service reabre token que dá acesso a código-fonte"* — o
   * link público é de uso único e morre no primeiro uso; corrigir é daqui.
   *
   * **O login é validado no GitHub antes de gravar**, e isso não é zelo: um typo
   * convida um estranho para um repositório privado, e o erro só apareceria quando
   * o estranho aceitasse. Grava-se o `login` **canônico** que a API devolve, não o
   * digitado — o GitHub normaliza caixa, e a reconciliação compara strings.
   *
   * **Substituir cancela o convite pendente e reagenda** (§Escopo). Sem isso, o
   * convite antigo continuaria de pé: o username errado seguiria podendo aceitar,
   * e o certo nunca receberia convite — os dois erros ao mesmo tempo, nenhum
   * visível.
   */
  async setUsername(
    tenantId: string,
    licenseId: string,
    username: unknown,
  ): Promise<{ username: string; previousInviteCanceled: boolean }> {
    const bruto = typeof username === 'string' ? username.trim() : '';

    // Sintaxe antes da rede — mesmo motivo do PR-2: sem isto, `../../admin` é
    // interpolado direto em `GET /users/:username`.
    if (!isValidGithubUsername(bruto)) {
      throw new UnprocessableEntityException(
        'Username do GitHub inválido (letras, números e hífen, até 39 caracteres)',
      );
    }

    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: { id: true, sourceAccess: true, githubUsername: true },
    });
    if (!licenca) throw new NotFoundException('Licença não encontrada');

    // Licença que não concede source não tem username a gravar. Sem esta guarda,
    // o admin gravaria um username numa licença comum e nada aconteceria nunca —
    // sintoma "salvei e o convite não sai".
    if (licenca.sourceAccess === 'NONE') {
      throw new UnprocessableEntityException(
        'Esta licença não concede acesso ao código-fonte',
      );
    }

    const usuario = await this.github.findUser(bruto);
    if (!usuario) {
      // Nomeia o que foi procurado — é o que permite ao admin ver o typo.
      throw new UnprocessableEntityException(
        `O usuário "${bruto}" não existe no GitHub`,
      );
    }

    // Se já havia convite pendente, ele morre agora: quem foi convidado por
    // engano perde o convite, e a licença volta para a fila do job com o username
    // novo.
    let previousInviteCanceled = false;
    if (licenca.sourceAccess === 'INVITED' || licenca.sourceAccess === 'ACTIVE') {
      const desfecho = await this.revokes.revoke(
        tenantId,
        licenseId,
        `troca de username pelo admin (era ${licenca.githubUsername ?? '—'})`,
      );
      previousInviteCanceled = desfecho !== 'nothing_to_do' && desfecho !== 'failed';

      if (desfecho === 'failed') {
        // **Não grava o username novo.** O acesso antigo continua de pé, e
        // sobrescrever o username perderia a informação de QUEM ainda tem acesso
        // — o `githubUsername` é o que a remoção usa. O admin vê a falha na
        // pendência, conserta a causa e repete.
        throw new UnprocessableEntityException(
          'O acesso do username anterior não pôde ser removido — corrija a causa na pendência e tente de novo',
        );
      }
    }

    await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        // O canônico do GitHub, nunca o digitado.
        githubUsername: usuario.login,
        // Volta para a fila do job: `PENDING` é o estado que o `reconcile` busca.
        // Sem isto, a licença ficaria em `REMOVED` (se houve troca) e o convite
        // novo nunca sairia.
        sourceAccess: 'PENDING',
        githubInvitationId: null,
        sourceAccessError: null,
        events: {
          create: {
            tenantId,
            type: 'source_username_set',
            payload: {
              username: usuario.login,
              previous: licenca.githubUsername,
              by: 'admin',
            },
          },
        },
      },
    });

    this.logger.log(
      `Licença ${licenseId}: username ${usuario.login} gravado pelo admin` +
        (previousInviteCanceled ? ' (convite anterior cancelado)' : ''),
    );

    // Gatilho por evento (SPEC-048): se o 8º dia já passou, o convite sai em
    // segundos em vez de esperar a rodada da madrugada. Se não passou, a rodada
    // não encontra nada — o prazo continua sendo do filtro, não daqui.
    //
    // **Depois do update, e sem `await` que possa falhar a operação**: o método
    // não lança por Redis fora, e é essa garantia que permite chamá-lo aqui sem
    // arriscar o `username` que acabou de ser gravado.
    await this.invites.agendarReconciliacao(tenantId);

    return { username: usuario.login, previousInviteCanceled };
  }

  /**
   * Reemite o convite — o botão de *"agora vai"*.
   *
   * **Roda a reconciliação do tenant, não uma chamada avulsa ao GitHub.** É o
   * mesmo caminho do job (mesmas guardas, mesma idempotência, mesma trilha):
   * duplicar a lógica de convite aqui criaria um segundo lugar que precisa acertar
   * o estado, e o modo de errar é o silencioso — dois convites, ou `INVITED` com
   * id nulo.
   *
   * O efeito colateral é deliberado: reemitir para uma licença também recolhe
   * qualquer outra que estivesse pronta. Chamar isso de "reemitir a licença X"
   * seria mentir sobre o escopo, então o retorno devolve o resultado da rodada
   * inteira.
   */
  async reinvite(tenantId: string, licenseId: string): Promise<ReconcileResult> {
    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: { id: true, sourceAccess: true, githubUsername: true },
    });
    if (!licenca) throw new NotFoundException('Licença não encontrada');

    if (!licenca.githubUsername) {
      // Sem username não há a quem convidar. Recusar aqui, nomeando a causa, é o
      // que impede o admin de clicar "reemitir" três vezes esperando resultado.
      throw new UnprocessableEntityException(
        'Grave o username do GitHub antes de reemitir o convite',
      );
    }

    // `FAILED` volta para `PENDING`: é o estado que o `reconcile` busca. Sem esta
    // linha, o botão rodaria a rodada e a licença em `FAILED` seria ignorada — o
    // sintoma seria "cliquei em reemitir e nada aconteceu".
    if (licenca.sourceAccess === 'FAILED') {
      await this.prisma.license.update({
        where: { id: licenseId },
        data: { sourceAccess: 'PENDING', sourceAccessError: null },
      });
    }

    const resultado = await this.invites.reconcile(tenantId);
    this.logger.log(
      `Reconciliação disparada pelo admin a partir da licença ${licenseId}: ` +
        `${resultado.convidados} convidado(s), ${resultado.falhas} falha(s)`,
    );
    return resultado;
  }

  /**
   * Revogação manual (§Revogação → gatilhos: reembolso, chargeback e **manual**).
   *
   * Não toca o `status` da licença: remover do repo e revogar a licença são atos
   * diferentes. Quem quer os dois usa as duas rotas — e a que revoga a licença já
   * remove o acesso, pelo webhook ou pelo admin.
   */
  async removeAccess(
    tenantId: string,
    licenseId: string,
  ): Promise<{ outcome: RevokeOutcome }> {
    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: { id: true },
    });
    if (!licenca) throw new NotFoundException('Licença não encontrada');

    const outcome = await this.revokes.revoke(
      tenantId,
      licenseId,
      'revogação manual pelo admin',
    );
    return { outcome };
  }

  /** Configuração de source do tenant. O PAT **não** sai daqui. */
  async settings(tenantId: string): Promise<SourceSettingsView> {
    const [linha, produto] = await Promise.all([
      this.prisma.licSettings.findUnique({
        where: { tenantId },
        select: { githubPat: true },
      }),
      this.prisma.licProduct.findFirst({
        where: { tenantId, sourceRepo: { not: null } },
        select: { sourceRepo: true },
      }),
    ]);

    return {
      githubPatSet: Boolean(linha?.githubPat),
      sourceRepo: produto?.sourceRepo ?? null,
    };
  }

  /**
   * Grava o PAT, **cifrado**.
   *
   * Vazio é recusado em vez de gravado: um PAT em branco pararia os convites e o
   * sintoma seria o mesmo de um token expirado — indistinguível na pendência. Para
   * desligar, o caminho é revogar o token no GitHub, que é onde a decisão mora.
   */
  async setPat(tenantId: string, pat: unknown): Promise<SourceSettingsView> {
    const valor = typeof pat === 'string' ? pat.trim() : '';
    if (!valor) {
      throw new UnprocessableEntityException(
        '`githubPat` não pode ser vazio — os convites parariam sem erro visível',
      );
    }

    // Cifrado com o `TOKEN_ENCRYPTION_KEY` que já existe (decisão PI #2): um dump
    // do banco não pode virar acesso de escrita ao repositório privado.
    const githubPat = this.crypto.encrypt(valor);

    // **`upsert` sem tocar no segredo do webhook — FIX #212.** Antes isto exigia
    // a linha já criada, e a mensagem mandava configurar o webhook primeiro: um
    // tenant que só queria o acesso ao repo source ficava sem caminho pela
    // interface. São configurações independentes (uma convida ao repositório, a
    // outra recebe vendas), e amarrá-las era erro meu, copiado do
    // `updateSettings` — onde a regra é correta por outro motivo.
    //
    // O `create` **não** grava `webhookSecret`: ele é `String?` desde este fix, e
    // ausente continua significando "não configurou webhook", com toda entrega
    // recusada por `401` no intake. O que mudou é só quando a linha pode nascer.
    await this.prisma.licSettings.upsert({
      where: { tenantId },
      update: { githubPat },
      create: { tenantId, githubPat },
    });

    // Registra QUE mudou, nunca o valor.
    this.logger.log(`Tenant ${tenantId}: PAT de source atualizado`);
    return this.settings(tenantId);
  }

  /**
   * Teste de conexão — a metade que **antecipa** a falha (§Configuração por
   * tenant: *"a primeira venda não é o lugar de descobrir que o token está
   * errado"*).
   *
   * **Pergunta pela permissão, não só pela existência do repo**: um PAT só-leitura
   * enxerga o repositório e não consegue convidar ninguém. Sem checar
   * `permissions.admin`, o teste passaria e o convite falharia — o pior desfecho,
   * porque o operador teria uma confirmação verde.
   *
   * Nunca lança: toda falha volta como `{ ok: false, reason }` legível. Um `500`
   * aqui diria "o ProPlan quebrou" sobre um teste cujo resultado é justamente
   * *"seu token está errado"*.
   */
  async testConnection(tenantId: string): Promise<ConnectionTest> {
    const linha = await this.prisma.licSettings.findUnique({
      where: { tenantId },
      select: { githubPat: true },
    });
    if (!linha?.githubPat) return { ok: false, reason: 'PAT não configurado' };

    const produto = await this.prisma.licProduct.findFirst({
      where: { tenantId, sourceRepo: { not: null } },
      select: { sourceRepo: true },
    });
    if (!produto?.sourceRepo) {
      return {
        ok: false,
        reason: 'nenhum produto tem `sourceRepo` configurado — o convite não teria destino',
      };
    }

    let claro: string;
    try {
      claro = this.crypto.decrypt(linha.githubPat);
    } catch {
      // Cifra ilegível (chave trocada, valor corrompido). O log não ecoa o valor.
      this.logger.error(`Tenant ${tenantId}: PAT de source ilegível`);
      return { ok: false, reason: 'PAT ilegível — grave o token de novo' };
    }

    try {
      const acesso = await this.github.checkRepoAccess(claro, produto.sourceRepo);
      return acesso.ok
        ? { ok: true, repo: produto.sourceRepo }
        : { ok: false, reason: acesso.reason };
    } catch (erro) {
      // Rede fora não é "token inválido", e dizer que é mandaria o operador
      // trocar um token que está correto. E a mensagem é fixa: a de um `fetch`
      // pode arrastar o header `Authorization`, que esta resposta exibe na tela.
      this.logger.warn(
        `Tenant ${tenantId}: teste de conexão falhou — ` +
          `${(erro instanceof Error ? erro.message : String(erro)).replace(/Bearer\s+\S+/gi, 'Bearer [redigido]')}`,
      );
      return { ok: false, reason: 'não foi possível falar com o GitHub agora' };
    }
  }
}
