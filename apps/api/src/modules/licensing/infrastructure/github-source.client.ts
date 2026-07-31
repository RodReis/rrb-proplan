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
 * ## As quatro operações, na mesma credencial
 *
 * `GET /users/:username` valida o login na página pública (PR-2); `invite` e
 * `isCollaborator` são a reconciliação (PR-3); `cancelInvitation` e
 * `removeCollaborator` desfazem o acesso (PR-4). Todas no mesmo cliente, porque
 * é o mesmo PAT — e concentrá-las aqui é o que mantém `administration:write`
 * num único arquivo.
 *
 * `assetDownloadUrl` (SPEC-041) e `getAsset` (FIX #242) entram pelo mesmo PAT,
 * com `contents:read`: uma cunha a URL assinada do download, a outra descreve o
 * asset para o cadastro conferir antes de gravar. **Nenhuma das duas move
 * bytes** — ver o `Accept` de cada uma, que é onde essa promessa vive.
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
   *
   * ## Dois escopos desde a SPEC-041, e o segundo falha ainda mais calado
   *
   * A Fatia 30 acrescentou um segundo uso ao **mesmo** PAT, no **mesmo** repo:
   * baixar o asset da Release privada (`contents:read`, refletido em
   * `permissions.pull`). São capacidades independentes na configuração do token
   * — dá para conceder administração sem conteúdo —, então o teste passa a
   * exigir as duas.
   *
   * **Por que checar `pull` explicitamente, se admin quase sempre o implica**: o
   * que se testa aqui não é a álgebra das permissões, é o que a resposta do
   * GitHub **afirma**. Se um dia um token administrar sem ler conteúdo, o
   * desfecho é o pior que existe neste módulo: a máquina do cliente para de
   * receber update e **ninguém no admin fica sabendo** — não há venda travada,
   * não há pendência, não há erro. Um `false` aqui é barato; descobrir pela
   * ausência de reclamação é caro.
   *
   * O motivo nomeia **qual** escopo falta, senão o operador reemite o token com o
   * mesmo erro.
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

    const body = (await res.json()) as {
      permissions?: { admin?: boolean; pull?: boolean };
    };
    if (!body.permissions?.admin) {
      return { ok: false, reason: 'o token não tem permissão de administração no repositório' };
    }
    if (!body.permissions?.pull) {
      return {
        ok: false,
        reason:
          'o token não tem permissão de leitura de conteúdo (`contents:read`) — o download de releases falharia sem aviso',
      };
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

  /**
   * Cancela um convite **ainda não aceito** (SPEC-039 §Revogação).
   *
   * `DELETE /repos/:owner/:repo/invitations/:id` — pelo **id da invitation**, não
   * pelo username. É a chamada de quem está em `INVITED`: o convite existe, o
   * assento de colaborador não.
   *
   * **Chamar `removeCollaborator` aqui seria no-op silencioso**: a API responde
   * `204` para quem não é colaborador, nada aparece em log, e o convite continua
   * de pé — o reembolsado só precisa aceitá-lo depois. Foi por essa diferença que
   * o `sourceInvited: Boolean` da SPEC-036 morreu no PR-1.
   *
   * `404` é **sucesso**: o convite já não existe (o comprador aceitou entre a
   * nossa leitura e esta chamada, ou alguém cancelou pela interface do GitHub).
   * Tratar como erro poria a licença em `FAILED` e faria o admin retentar para
   * sempre uma remoção que não tem o que remover. Quem cuida do caso "aceitou no
   * meio do caminho" é o `removeCollaborator` da rodada seguinte, porque o estado
   * volta pela reconciliação.
   */
  async cancelInvitation(pat: string, repo: string, invitationId: string): Promise<void> {
    const res = await this.send(
      'DELETE',
      `https://api.github.com/repos/${repo}/invitations/${encodeURIComponent(invitationId)}`,
      pat,
    );

    // 204 = cancelado. 404 = já não existe, que é o mesmo desfecho desejado.
    if (res.status === 204 || res.status === 404) return;

    throw new GithubSourceError(this.motivo(res.status), res.status);
  }

  /**
   * Remove o colaborador **aceito** (SPEC-039 §Revogação).
   *
   * `DELETE /repos/:owner/:repo/collaborators/:username` — a chamada de quem está
   * em `ACTIVE`.
   *
   * **O que esta remoção entrega é o fim dos *updates*, não a recuperação do
   * código** (§Objetivo da spec): o que já foi clonado continua clonado. O
   * mecanismo real do produto é contratual (§8 do MVP4), e nenhuma tela pode
   * sugerir o contrário.
   *
   * `204` é a única resposta de sucesso — e a API devolve `204` **também para
   * quem nunca foi colaborador**. É justamente essa indiferença que torna a
   * escolha da chamada responsabilidade de quem sabe o estado (o service), nunca
   * deste cliente: aqui não há como distinguir "removi" de "não havia nada".
   */
  async removeCollaborator(pat: string, repo: string, username: string): Promise<void> {
    const res = await this.send(
      'DELETE',
      `https://api.github.com/repos/${repo}/collaborators/${encodeURIComponent(username)}`,
      pat,
    );

    if (res.status === 204) return;

    throw new GithubSourceError(this.motivo(res.status), res.status);
  }

  /**
   * URL assinada de vida curta para o asset da Release privada (SPEC-041 §Notas
   * técnicas, ADR-028 decisão 2).
   *
   * **`redirect: 'manual'` é a linha mais importante do método.** Com o `follow`
   * padrão do `fetch`, o Node seguiria o `302` e começaria a baixar os ~80 MB
   * **para dentro da API** — exatamente o que o ADR-028 existe para impedir, e o
   * critério de aceite *"nenhum byte do artefato passa pela API"* deixaria de
   * valer sem que nada quebrasse: a rota continuaria respondendo, só que gorda.
   * O que se quer é o **envelope**, não o conteúdo.
   *
   * `Accept: application/octet-stream` é o que faz a API responder com o
   * redirect em vez do JSON de metadados do asset — sem ele, o `Location` não
   * existe e o método devolveria a descrição do arquivo achando que é o arquivo.
   *
   * **A URL não é cacheável e não é guardada**: expira em segundos a minutos e é
   * cunhada a cada chamada (é por isso que `check` e `download` são rotas
   * separadas). Guardá-la em coluna ou memória entregaria ao cliente seguinte um
   * link já morto — falha que aparece como "download não começa", longe daqui.
   *
   * **Nenhum desfecho vira `500`.** Todos os erros saem como `GithubSourceError`
   * com motivo legível, porque o modo de errar aqui é mudo: PAT sem
   * `contents:read` responde `404` (o GitHub esconde o que o token não alcança),
   * e um `500` genérico mandaria o operador procurar defeito no ProPlan em vez de
   * no escopo do token.
   */
  /**
   * Os metadados do asset — o que o **cadastro** confere antes de gravar.
   *
   * **Não é o `assetDownloadUrl` com outro nome, e a diferença é o `Accept`.**
   * Aquele pede `octet-stream`, que faz a API redirecionar para o storage: prova
   * que o asset existe, mas devolve um `Location` e nada mais. Aqui se pede o
   * JSON, porque o que se quer é justamente a *descrição* do arquivo — `digest`
   * para conferir contra o `sha256` digitado, e `name` para o operador
   * reconhecer o que registrou.
   *
   * **Nenhum byte é baixado**: o JSON de metadados pesa menos de 1 KB, e o
   * redirect não chega a existir sem o `octet-stream`.
   *
   * `null` significa **"não existe ou está fora do alcance do PAT"** — os dois
   * saem como `404` no GitHub, que esconde o que o token não vê, e distingui-los
   * daqui seria inventar informação. Falha de rede e `401`/`403` **lançam**:
   * tratá-los como "asset inexistente" mandaria o operador corrigir um id que
   * está certo.
   */
  async getAsset(pat: string, repo: string, assetId: string): Promise<GithubAsset | null> {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/assets/${encodeURIComponent(assetId)}`,
      {
        method: 'GET',
        headers: {
          // JSON, não `octet-stream`: é o que impede o 302 e devolve a descrição.
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'rrb-proplan',
          Authorization: `Bearer ${pat}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (res.status === 404) return null;
    if (!res.ok) throw new GithubSourceError(this.motivoAsset(res.status), res.status);

    const corpo = (await res.json()) as {
      name?: unknown;
      size?: unknown;
      digest?: unknown;
    };

    // O `digest` vem como `sha256:abc…` e é opcional na API — assets antigos não
    // o têm. `null` aqui significa "o GitHub não disse", que é diferente de
    // "não bate": quem chama precisa poder deixar passar em vez de acusar
    // divergência sobre um hash que ninguém afirmou.
    const digest = typeof corpo.digest === 'string' ? corpo.digest : null;
    const sha256 = digest?.startsWith('sha256:') ? digest.slice(7).toLowerCase() : null;

    return {
      name: typeof corpo.name === 'string' ? corpo.name : '',
      size: typeof corpo.size === 'number' ? corpo.size : 0,
      sha256,
    };
  }

  async assetDownloadUrl(pat: string, repo: string, assetId: string): Promise<string> {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/assets/${encodeURIComponent(assetId)}`,
      {
        method: 'GET',
        headers: {
          // Octet-stream: pede o BINÁRIO. É o que dispara o 302 para o storage.
          Accept: 'application/octet-stream',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'rrb-proplan',
          Authorization: `Bearer ${pat}`,
        },
        // Sem isto a API baixaria o instalador inteiro. Ver acima.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    // 302 é o desfecho ESPERADO — não é erro. O `Location` é a resposta.
    if (res.status === 302 || res.status === 307) {
      const location = res.headers.get('location');
      // `Location` vazio num 302 é contrato quebrado do GitHub, não configuração
      // do operador. Devolver string vazia daria ao cliente uma URL que falha
      // como "download corrompido" — o erro precisa dizer o que é.
      if (!location) {
        throw new GithubSourceError('o GitHub redirecionou sem endereço de download', 502);
      }
      return location;
    }

    // 200 aqui significa que o asset não redirecionou — sem `Location` não há o
    // que devolver, e ler o corpo seria justamente puxar os bytes pela API.
    if (res.ok) {
      throw new GithubSourceError('o GitHub não devolveu URL de download para o asset', 502);
    }

    throw new GithubSourceError(this.motivoAsset(res.status), res.status);
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
   * O mesmo status quer dizer outra coisa no caminho do asset — por isso a
   * segunda tabela, e não um parâmetro no `motivo`.
   *
   * `403` no convite é *"falta administração"*; aqui é **`contents:read`**, o
   * escopo que a SPEC-041 acrescentou ao mesmo PAT. Reaproveitar a mensagem do
   * convite mandaria o operador reemitir o token com a permissão errada — e o
   * sintoma (update que não chega) não o corrigiria, porque ele é silencioso.
   *
   * `404` continua ambíguo por desenho do GitHub (asset removido *ou* token sem
   * alcance), então a mensagem diz as duas coisas em vez de escolher a errada.
   */
  private motivoAsset(status: number): string {
    if (status === 401) return 'token inválido ou expirado';
    if (status === 403) {
      return 'o token não tem permissão de leitura de conteúdo (`contents:read`) no repositório';
    }
    if (status === 404) {
      return 'asset não encontrado no GitHub ou fora do escopo do token (`contents:read`)';
    }
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

/** O asset visto pelo cadastro de release — descrição, nunca conteúdo. */
export interface GithubAsset {
  /** Nome do arquivo, para o operador reconhecer o que registrou. */
  name: string;
  /** Bytes. Só exibição — nada decide por ele. */
  size: number;
  /**
   * Hash do arquivo segundo o GitHub, já sem o prefixo `sha256:`.
   *
   * `null` quando o GitHub não informa (o campo é recente; asset antigo não o
   * tem). Não é "não bate" — é "não foi dito", e confundir os dois faria o
   * cadastro recusar um hash correto.
   */
  sha256: string | null;
}
