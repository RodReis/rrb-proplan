import { Injectable, Logger } from '@nestjs/common';

const TIMEOUT_MS = 10_000;

/**
 * O GitHub visto pelo caminho do convite ao repo source (SPEC-039).
 *
 * ## Por que um cliente próprio, e não o do GitHub App
 *
 * **São credenciais de propósitos diferentes, e misturá-las reabre o ADR-015 por
 * acidente.** O App autentica *usuários* e *instalações*: toda leitura com o
 * `userToken` de quem está logado, toda escrita como `proplan[bot]`. Aqui não há
 * usuário no pedido — quem pede é uma máquina licenciada, ou um job noturno — e
 * o que se precisa é `administration:write` **num único repositório** (decisão #8
 * do MVP4).
 *
 * Expandir o App para conceder isso exigiria **re-consent de todas as
 * instalações** por causa de um repositório privado de um tenant. O PAT
 * fine-grained resolve com escopo menor: um token, um repo, uma permissão.
 *
 * O `installation-token-usage.arch.spec.ts` (ADR-015) barra
 * `.installationToken(` fora da allowlist de escrita — este arquivo não está
 * nela e não chama o método. A separação é verificável, não é promessa.
 *
 * ## O PAT nunca chega aqui em claro do banco
 *
 * Quem descriptografa é o service; este cliente recebe o token já em claro como
 * argumento e **não o registra em log** — nem em caso de erro. Um `403` que
 * ecoasse o header entregaria `administration:write` no repositório privado de
 * outra pessoa a quem lê log.
 *
 * ## Nesta fatia, só leitura de usuário
 *
 * `GET /users/:username` é tudo que o PR-2 precisa: a página pública valida o
 * login antes de gravar. Convidar, remover colaborador e cancelar *invitation*
 * são do PR-3/PR-4 e entram aqui depois — no mesmo cliente, porque é a mesma
 * credencial.
 */
@Injectable()
export class GithubSourceClient {
  private readonly logger = new Logger(GithubSourceClient.name);

  /**
   * O usuário existe no GitHub? Devolve o que a página mostra para confirmação.
   *
   * **Validar existência não é validar identidade** (§Escopo). Este endpoint
   * confirma que o login existe — não que ele é do comprador. É por isso que a
   * resposta traz `avatarUrl` e `name`: quem confirma é a pessoa, olhando a
   * foto. Sem esse passo, um typo convida um estranho para um repositório
   * privado, e o erro só apareceria quando o estranho aceitasse.
   *
   * `null` significa **"não existe"** e nada mais. Falha de rede e `403` de rate
   * limit **lançam**, porque tratá-los como "não existe" diria ao comprador que
   * o próprio username está errado — ele corrigiria um dado correto, ou
   * desistiria. O sintoma seria *"o GitHub caiu e o cliente achou que digitou
   * errado"*.
   *
   * Chamado **sem** autenticação de PAT de propósito: `GET /users/:username` é
   * público, e usar o PAT do tenant aqui gastaria a cota dele numa consulta que
   * não precisa de privilégio nenhum.
   */
  async findUser(username: string): Promise<GithubUser | null> {
    const res = await this.get(`https://api.github.com/users/${encodeURIComponent(username)}`);

    // 404 é a resposta ESPERADA de "esse login não existe" — o caso que a página
    // precisa distinguir para recusar nomeando o que foi procurado.
    if (res.status === 404) return null;

    if (!res.ok) {
      // Inclui o `403` de rate limit da API pública. Lançar é o certo: a página
      // responde "não foi possível verificar agora", que é verdade, em vez de
      // "esse usuário não existe", que é mentira.
      this.logger.warn(`GET /users respondeu ${res.status} para o login consultado`);
      throw new Error(`GitHub respondeu ${res.status} ao verificar o usuário`);
    }

    const body = (await res.json()) as {
      login?: string;
      name?: string | null;
      avatar_url?: string;
    };

    // O `login` do corpo, não o que foi digitado: o GitHub normaliza caixa
    // (`RodReis` e `rodreis` são o mesmo usuário) e é o valor canônico que tem de
    // ser gravado — convidar com a caixa errada funciona, mas a reconciliação
    // compara strings e não encontraria o colaborador depois.
    if (!body.login) throw new Error('GitHub devolveu usuário sem login');

    return {
      login: body.login,
      name: body.name ?? null,
      avatarUrl: body.avatar_url ?? null,
    };
  }

  /**
   * O PAT serve para o repo configurado? (§Configuração por tenant.)
   *
   * **PAT fine-grained expira** — é limite do GitHub, não escolha nossa. Uma
   * expiração silenciosa pararia os convites sem nenhum erro visível: o job
   * roda, falha, e o comprador espera. O que torna isso visível é o par *teste de
   * conexão no admin* + *pendência `FAILED`* — e este método é a primeira metade.
   *
   * Pergunta pela **permissão**, não só pela existência do repo: um PAT só-leitura
   * enxerga o repositório e não consegue convidar ninguém. `permissions.admin` é
   * o que o convite exige, e descobrir isso na primeira venda seria descobrir
   * tarde.
   */
  async checkRepoAccess(pat: string, repo: string): Promise<RepoAccess> {
    const res = await this.get(`https://api.github.com/repos/${repo}`, pat);

    if (res.status === 401) return { ok: false, reason: 'token inválido ou expirado' };
    if (res.status === 404) {
      // 404 e não 403 quando o token não alcança o repo: a API do GitHub esconde
      // repositório privado que o token não vê. "Não existe" e "não tenho
      // permissão" chegam iguais, então a mensagem diz as duas coisas.
      return { ok: false, reason: 'repositório não encontrado ou fora do escopo do token' };
    }
    if (!res.ok) return { ok: false, reason: `GitHub respondeu ${res.status}` };

    const body = (await res.json()) as { permissions?: { admin?: boolean } };
    if (!body.permissions?.admin) {
      return { ok: false, reason: 'o token não tem permissão de administração no repositório' };
    }
    return { ok: true };
  }

  /**
   * Convida ao repo com permissão `pull` (SPEC-039 §Job do convite).
   *
   * **Dois desfechos de sucesso, e a documentação oficial foi o que me disse
   * isso** — eu teria tratado tudo como convite:
   *
   * - **`201`** → convite criado. O corpo traz a *invitation*, e o `id` dela é o
   *   que permite **cancelar** depois (`DELETE /invitations/:id`, PR-4). Sem
   *   guardar esse id, a revogação só saberia remover colaborador — que é no-op
   *   em convite não aceito, e o reembolsado ficaria com acesso.
   * - **`204`** → **já era colaborador**, e nenhum convite foi emitido. Acontece
   *   quando o comprador já tinha acesso (recompra, ou convite aceito entre a
   *   nossa leitura e esta chamada). Tratar como `INVITED` deixaria a licença
   *   esperando para sempre uma aceitação que já aconteceu; o certo é `ACTIVE`.
   *
   * `permission: 'pull'` — leitura e nada mais. O produto é o código-fonte, não
   * a colaboração: `push` deixaria o comprador escrever no repositório do
   * vendedor.
   */
  async invite(pat: string, repo: string, username: string): Promise<InviteResult> {
    const res = await this.send('PUT', `https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(username)}`, pat, {
      permission: 'pull',
    });

    // 204: já é colaborador. A API não devolve corpo, e não há invitation.
    if (res.status === 204) return { kind: 'already_collaborator' };

    if (res.status === 201) {
      const body = (await res.json()) as { id?: number };
      // Sem `id` no corpo, o convite existe e não temos como cancelá-lo. Melhor
      // registrar como colaborador-em-potencial e deixar a reconciliação
      // resolver do que gravar `INVITED` com id nulo e mentir para o PR-4.
      return { kind: 'invited', invitationId: body.id != null ? String(body.id) : null };
    }

    throw new GithubSourceError(this.motivo(res.status), res.status);
  }

  /**
   * O usuário já é colaborador do repo? (`204` sim, `404` não.)
   *
   * É como a **aceitação é descoberta**: o GitHub não manda webhook de convite
   * aceito nesta configuração (repo pessoal), então `INVITED → ACTIVE` sai desta
   * pergunta, feita pela reconciliação.
   */
  async isCollaborator(pat: string, repo: string, username: string): Promise<boolean> {
    const res = await this.send(
      'GET',
      `https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(username)}`,
      pat,
    );

    if (res.status === 204) return true;
    if (res.status === 404) return false;
    // Qualquer outra coisa é indefinição, não "não é colaborador". Devolver
    // `false` num 403 faria a reconciliação concluir que o convite não foi aceito
    // — e no PR-4 isso viraria a chamada errada de revogação.
    throw new GithubSourceError(this.motivo(res.status), res.status);
  }

  /** Mensagem legível por status — é o que vai para `sourceAccessError`. */
  private motivo(status: number): string {
    if (status === 401) return 'token inválido ou expirado';
    if (status === 403) return 'token sem permissão de administração no repositório';
    if (status === 404) return 'repositório não encontrado ou fora do escopo do token';
    if (status === 422) return 'o GitHub recusou o convite (validação)';
    return `GitHub respondeu ${status}`;
  }

  /**
   * `fetch` com timeout e headers da API. Um único lugar por dois motivos: o
   * `User-Agent` (a API do GitHub recusa requisição sem ele) e a garantia de que
   * nenhum caminho novo esqueça o `AbortSignal.timeout` — sem ele, um GitHub
   * lento pendura o job noturno indefinidamente.
   */
  private get(url: string, pat?: string): Promise<Response> {
    return this.send('GET', url, pat);
  }

  private send(
    method: string,
    url: string,
    pat?: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'rrb-proplan',
        ...(pat ? { Authorization: `Bearer ${pat}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}

/**
 * Falha do GitHub com motivo legível e status.
 *
 * **Não carrega o PAT, nem em `cause`.** Esta mensagem vai para
 * `License.sourceAccessError`, que a lista de pendências do admin exibe — e um
 * token nela entregaria `administration:write` no repositório privado a quem
 * abrir a tela.
 */
export class GithubSourceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** O que `invite` descobriu. Os dois desfechos de sucesso da API do GitHub. */
export type InviteResult =
  | { kind: 'invited'; invitationId: string | null }
  | { kind: 'already_collaborator' };

/** O que a página mostra para o comprador confirmar antes de gravar. */
export interface GithubUser {
  /** Valor canônico do GitHub (caixa normalizada) — é o que se grava. */
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export type RepoAccess = { ok: true } | { ok: false; reason: string };
