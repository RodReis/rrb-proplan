import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../mail/application/mail.service';
import { GithubSourceClient } from '../infrastructure/github-source.client';
import {
  generateToken,
  hashToken,
  isValidGithubUsername,
  sourceLinkStatus,
  type SourceLinkStatus,
} from '../domain/source-token';

/** O que a rota pública devolve ao abrir o link (§Contratos). */
export interface PublicSourceLinkResponse {
  status: SourceLinkStatus;
  /** Só produto e edição. Nenhum dado pessoal do comprador. */
  product?: string;
  edition?: string;
}

/** Resultado da consulta de username, antes da confirmação. */
export interface UsernameLookup {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * URL da página de coleta.
 *
 * **A página é do web, não da API** — `/s/:token` é rota React, e a API expõe
 * `/licensing/v1/source-links/:token` para ela consumir. Mandar a base da API
 * aqui levaria o comprador a um JSON, ou ao catálogo, sem erro visível: é
 * exatamente o que já aconteceu com `/b/` (web) e `/c/` (API) nesta base.
 */
function paginaDeColeta(token: string): string {
  const base = process.env.FRONTEND_URL ?? 'http://localhost:5180';
  return `${base.replace(/\/$/, '')}/s/${token}`;
}

/** Colunas devolvidas pela `resolve_source_link` (PR-1). */
interface ResolvedSourceLinkRow {
  id: string;
  used_at: Date | null;
  tenant_id: string;
  license_id: string;
  license_status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  source_access: string;
  product_name: string;
  edition_name: string;
}

/** Erros que a rota traduz em status HTTP — o service não conhece HTTP. */
export class SourceLinkUsedError extends Error {}
export class SourceLinkInvalidError extends Error {}
export class GithubUserNotFoundError extends Error {}
export class GithubUnavailableError extends Error {}

/**
 * O link de coleta do username (SPEC-039 §Escopo → Coleta do username).
 *
 * ## Por que a resolução pública passa por função SQL
 *
 * `GET /s/:token` **não tem sessão**, então roda sem `app.tenant_ids`, e o RLS de
 * `lic_source_links` é fail-closed: um SELECT direto voltaria vazio para TODO
 * token, inclusive os válidos — e cada comprador legítimo veria "link inválido",
 * sem erro no log. É a 6ª ocorrência da mesma classe de bug nesta base, e a
 * `resolve_source_link` (SECURITY DEFINER, PR-1) é a resposta.
 *
 * Ela devolve só *"este token serve, e para qual licença?"* — **nenhum dado
 * pessoal**. O que a página mostra (produto e edição) vem dela; qualquer leitura
 * além disso acontece depois, sob `runInTenantContext`, para que quem protege o
 * conteúdo continue sendo o RLS.
 *
 * ## O que este service protege
 *
 * O token **concede acesso a código-fonte privado**: quem tiver a URL grava o
 * próprio username e é convidado ao repositório. Três mitigações moram aqui, e
 * nenhuma elimina o risco (§Notas técnicas):
 *
 * 1. **Uso único** — `usedAt` na mesma escrita que grava o username. A janela
 *    fecha no evento que importa, não num relógio.
 * 2. **Confirmação com avatar** — gravar exige `confirm: true`, e a página só
 *    oferece confirmar depois de mostrar quem é.
 * 3. **E-mail nomeando o convidado** — é o canal por onde o erro volta *antes*
 *    de virar acesso. A tela protege contra descuido; o e-mail, contra o
 *    descuido confirmado.
 */
@Injectable()
export class SourceLinkService {
  private readonly logger = new Logger(SourceLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly github: GithubSourceClient,
  ) {}

  /**
   * Cria o link e enfileira o e-mail de coleta. Chamado na compra da edição que
   * concede source (PR-3 liga isso ao webhook) e pelo admin ao corrigir.
   *
   * **Criar um novo invalida o anterior**: dois links vivos para a mesma licença
   * significaria que usar um não fecha o outro — e o uso único deixaria de ser
   * único. Marca `usedAt` nos antigos em vez de apagar: a trilha de que um link
   * existiu é o que explica, meses depois, por que o username mudou.
   *
   * Roda sob contexto de tenant já aberto pelo chamador.
   */
  async createAndSend(tenantId: string, licenseId: string): Promise<{ token: string }> {
    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: {
        customerEmail: true,
        customerName: true,
        edition: { select: { name: true, product: { select: { name: true } } } },
      },
    });
    if (!licenca) throw new SourceLinkInvalidError('licença não encontrada');

    const token = generateToken();
    const now = new Date();

    // Interativa, não lote: sob contexto de tenant o lote sairia em duas
    // conexões (issue #113 e `batch-transaction.arch.spec.ts`).
    await this.prisma.$transaction(async (tx) => {
      await tx.licSourceLink.updateMany({
        where: { licenseId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.licSourceLink.create({
        data: { tenantId, licenseId, tokenHash: hashToken(token) },
      });
    });

    await this.mail.send({
      tenantId,
      to: licenca.customerEmail,
      template: 'source_username_request',
      licenseId,
      data: {
        customerName: licenca.customerName,
        productName: licenca.edition.product.name,
        editionName: licenca.edition.name,
        // A URL montada, não o token cru: quem renderiza é o worker, e o
        // template não deveria saber como se constrói a rota pública.
        //
        // **O token atravessa o Redis dentro desta URL** — mesmo caminho que a
        // chave em claro do `license_key` já percorre (SPEC-038), e pelo mesmo
        // motivo: o corpo do e-mail não é persistido, então os dados do template
        // precisam viajar no job. O que limita o dano é o resto do desenho: uso
        // único, e o job é removido da fila ao concluir.
        url: paginaDeColeta(token),
      },
    });

    await this.evento(tenantId, licenseId, 'source_invite_sent', {});

    this.logger.log(`Link de coleta criado para a licença ${licenseId}`);
    return { token };
  }

  /**
   * Resolução PÚBLICA do token (`GET /s/:token`) — sem sessão.
   *
   * **Não-diferencial onde protege, distinto onde ajuda.** Token inexistente e de
   * outro tenant devolvem o MESMO `invalid` — os dois chegam como `null` da
   * função SQL, e é isso que impede enumeração. Mas `used` é distinto de
   * `invalid` de propósito: o critério de aceite exige que reabrir o próprio link
   * mostre "já utilizado", nunca o formulário de novo.
   */
  async resolvePublic(token: string): Promise<PublicSourceLinkResponse> {
    const row = await this.resolver(token);
    const status = sourceLinkStatus(row ? { usedAt: row.used_at } : null);

    if (!row) return { status };

    // Licença revogada não coleta username: o convite nunca sairia, e pedir o
    // dado seria coletar dado pessoal sem finalidade (LGPD). Responde `invalid`
    // e não um estado próprio — quem foi reembolsado não precisa de detalhe do
    // nosso lado, e um estado a mais aqui vazaria que a licença existiu.
    if (row.license_status !== 'ACTIVE') return { status: 'invalid' };

    return { status, product: row.product_name, edition: row.edition_name };
  }

  /**
   * Consulta o username no GitHub — o passo ANTES de gravar (§Escopo).
   *
   * Não grava nada: devolve quem foi encontrado para a página exibir avatar, nome
   * e login. **Validar existência não é validar identidade**, e é a pessoa que
   * confirma, olhando a foto.
   *
   * Exige token válido e não usado: sem isso, o endpoint viraria um proxy anônimo
   * de consulta à API do GitHub.
   */
  async lookupUsername(token: string, username: string): Promise<UsernameLookup> {
    await this.assertUsavel(token);
    return this.consultarGithub(username);
  }

  /**
   * Consulta o login no GitHub, distinguindo os três desfechos.
   *
   * Sem contato com o banco de propósito: a guarda do token é do chamador, e
   * separá-las deixa claro que "usuário não existe" e "GitHub indisponível" são
   * decisões desta função, não daquela.
   */
  private async consultarGithub(username: string): Promise<UsernameLookup> {
    // Sintaxe antes da rede. Sem isto, `../../admin` é interpolado na URL da API
    // e a requisição sai para outro endpoint do GitHub.
    if (!isValidGithubUsername(username)) {
      throw new GithubUserNotFoundError(username);
    }

    let usuario;
    try {
      usuario = await this.github.findUser(username);
    } catch (erro) {
      // Rede fora ou rate limit **não** é "usuário não existe". Dizer que é
      // faria o comprador corrigir um dado correto — ou desistir.
      this.logger.warn(
        `Consulta de username falhou: ${erro instanceof Error ? erro.message : erro}`,
      );
      throw new GithubUnavailableError();
    }

    if (!usuario) throw new GithubUserNotFoundError(username);
    return usuario;
  }

  /**
   * Grava o username confirmado e **queima o link na mesma escrita** (§Escopo).
   *
   * As duas coisas numa transação porque separá-las abriria a janela em que o
   * username está gravado e o link ainda serve — e o link serve para gravar
   * username. Quem tivesse a URL sobrescreveria o dado de quem comprou.
   *
   * O `confirm` é exigido aqui, não só na tela: um `POST` direto sem ele pularia
   * a confirmação por avatar, que é uma das três mitigações do risco aceito.
   */
  async setUsername(
    token: string,
    username: string,
    confirm: boolean,
  ): Promise<{ username: string }> {
    if (!confirm) throw new GithubUserNotFoundError(username);

    // Resolve o link UMA vez e reusa a linha. Resolver de novo depois da consulta
    // ao GitHub leria um estado que pode ter mudado no meio — e o que decide a
    // corrida é o `usedAt: null` no WHERE do update abaixo, não esta leitura.
    const row = await this.assertUsavel(token);
    // Consulta o GitHub pelo valor canônico (caixa normalizada): convidar com a
    // caixa errada funciona, mas a reconciliação do PR-3 compara strings e não
    // encontraria o colaborador depois.
    const usuario = await this.consultarGithub(username);
    const now = new Date();

    await this.prisma.runInTenantContext([row.tenant_id], async () => {
      await this.prisma.$transaction(async (tx) => {
        // `usedAt: null` no WHERE é a guarda contra corrida: duas requisições
        // simultâneas com o mesmo token — a segunda atualiza zero linhas e para
        // aqui, em vez de sobrescrever o username da primeira. Um `if` antes do
        // update deixaria as duas passarem.
        const queimado = await tx.licSourceLink.updateMany({
          where: { id: row.id, usedAt: null },
          data: { usedAt: now },
        });
        if (queimado.count === 0) throw new SourceLinkUsedError();

        await tx.license.update({
          where: { id: row.license_id },
          data: {
            githubUsername: usuario.login,
            // `PENDING` e não `INVITED`: o comprador informou o username, o
            // convite ainda não saiu. Marcar `INVITED` aqui afirmaria um convite
            // que ninguém emitiu — e o job do PR-3, que seleciona `PENDING`,
            // nunca convidaria esta licença.
            sourceAccess: 'PENDING',
            sourceAccessError: null,
          },
        });
      });

      await this.evento(row.tenant_id, row.license_id, 'source_username_set', {
        // O login NÃO é segredo (é público no GitHub) e é o que o admin precisa
        // ver na trilha. O token, sim, e ele não entra aqui.
        username: usuario.login,
      });

      const licenca = await this.prisma.license.findUnique({
        where: { id: row.license_id },
        select: {
          customerEmail: true,
          customerName: true,
          sourceInviteAt: true,
          edition: { select: { product: { select: { name: true } } } },
        },
      });

      if (licenca) {
        // O e-mail que nomeia quem será convidado. É a 3ª mitigação: a tela
        // protege contra descuido, este e-mail protege contra o descuido
        // confirmado — o comprador reclama antes do dia do convite.
        await this.mail.send({
          tenantId: row.tenant_id,
          to: licenca.customerEmail,
          template: 'source_username_confirmed',
          licenseId: row.license_id,
          data: {
            customerName: licenca.customerName,
            productName: licenca.edition.product.name,
            githubUsername: usuario.login,
            inviteAt: licenca.sourceInviteAt?.toISOString() ?? null,
          },
        });
      }
    });

    this.logger.log(`Username gravado para a licença ${row.license_id}`);
    return { username: usuario.login };
  }

  /**
   * O link resolve e ainda serve? Lança o erro que a rota traduz.
   *
   * `used` e `invalid` são erros DIFERENTES porque a rota responde `410` e `404`
   * — e o comprador que já informou precisa saber que informou.
   */
  private async assertUsavel(token: string): Promise<ResolvedSourceLinkRow> {
    const row = await this.resolver(token);
    if (!row || row.license_status !== 'ACTIVE') throw new SourceLinkInvalidError();
    if (row.used_at) throw new SourceLinkUsedError();
    return row;
  }

  private async resolver(token: string): Promise<ResolvedSourceLinkRow | null> {
    const rows = await this.prisma.$queryRaw<
      ResolvedSourceLinkRow[]
    >`SELECT * FROM resolve_source_link(${hashToken(token)})`;
    return rows[0] ?? null;
  }

  /** Trilha da licença. Roda sob contexto já aberto pelo chamador. */
  private async evento(
    tenantId: string,
    licenseId: string,
    type: string,
    payload: Prisma.InputJsonValue,
  ) {
    await this.prisma.licEvent.create({ data: { tenantId, licenseId, type, payload } });
  }
}
