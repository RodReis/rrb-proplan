---
proplan: v1
spec: SPEC-008
fatia: 4.5
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-008 — Migração para GitHub App (identidade de bot)

> **Fatia 4.5 — pré-requisito da Fatia 5.** Refatoração de autenticação (ADR-015, supersede o ADR-007). Existe agora, e não depois, porque a Fatia 5 já obriga a reconsentimento (escopo de escrita em Issues): trocar o mecanismo de auth **junto** custa quase nada; trocar depois custa reconsentir e migrar tokens de novo.

## Objetivo

Trocar o OAuth App por um **GitHub App**, para que (a) as escritas do ProPlan tenham **identidade própria** (`proplan[bot]`, nunca o usuário), (b) as permissões sejam mínimas e granulares em vez do escopo `repo` (que hoje concede escrita em tudo), e (c) o caminho para multi-tenant e webhooks fique aberto sem nova migração de auth.

## Escopo

### Módulo `identity`

- **Fluxo de login**: OAuth **do App** (authorization code + state anti-CSRF) → **user-to-server token** + refresh token, criptografados (AES-256-GCM) em `User`. Sessão JWT em cookie httpOnly permanece igual.
- **Refresh de token**: user-to-server expira (~8h). Renovação transparente com o refresh token; falha de refresh → sessão inválida, usuário reloga.
- **Installation token**: JWT assinado com a chave privada do App (RS256, `iss` = App ID, exp ≤ 10min) → `POST /app/installations/{id}/access_tokens`. **Cacheado em Redis por `installationId`** (não por projeto — projetos da mesma conta compartilham), TTL 55min (o token vale 1h). Renovação sob demanda.
- **`GithubAuth` (serviço público do `identity`)**: `userToken(userId)` e `installationToken(projectId)`. **Nenhum outro módulo sabe qual token é qual** — pede o certo pelo nome da operação.

**Regra que não se viola** (ADR-015):

| operação | token |
|---|---|
| listar repos, ler docs/árvore, ler issues, ler workflows, ler commits | **user-to-server** |
| commit (`.proplan/STATUS.md`, `.proplan/config.yml`), criar/mover/fechar issue, criar label | **installation** |

Leitura com installation token é **proibida** — o ProPlan enxergaria coisas que o usuário logado não enxerga. Erra silencioso e vaza no dia em que houver dois usuários.

### Módulo `catalog` — mudança de UX (custo aceito do ADR-015)

- O Catálogo deixa de listar "todos os repos do usuário" e passa a listar **os repos onde o App está instalado** (`GET /user/installations` + `GET /user/installations/{id}/repositories`, com o token do usuário).
- Estado vazio novo: **"O ProPlan ainda não está instalado em nenhum repositório"** + CTA **"Instalar no GitHub"** → redireciona para `https://github.com/apps/{slug}/installations/new`. Volta pelo `setup_url` e re-lista.
- Botão permanente **"Instalar em mais repositórios"** no topo do catálogo.
- **Repo gerenciado que perdeu a instalação** (o dono removeu o App): projeto entra em estado **`sem-instalação`** — leitura do cache continua, escritas ficam desabilitadas, faixa na UI explica e oferece reinstalar. **Nunca falha em silêncio.**

#### Instalação é **por conta** — pessoal ≠ organização

O caso real do PI: os repos vivem em **`RodReis`** (conta pessoal) e **`RodReis-Team`** (organização). Para o GitHub são contas distintas ⇒ **duas instalações separadas**, com `installation_id`, seleção de repos e token independentes. Nada é compartilhado.

- `GET /user/installations` retorna **N instalações**. O catálogo **agrupa por conta** (`RodReis` · `RodReis-Team`), com o CTA "instalar em mais repositórios" **por grupo** — senão o usuário não sabe em qual conta está instalando.
- **Estado "instalação sem repositórios acessíveis"**: a instalação existe mas devolve lista vazia. A UI mostra, **na própria conta**, `Nenhum repositório acessível nesta conta — revisar seleção no GitHub` + link. **Falha silenciosa aqui é o pior modo de falha da fatia**: o usuário acha que o produto está quebrado.

  Duas causas, **um só estado** (não fazer UI separada para cada):
  - o usuário instalou com "only select repositories" e **não marcou nenhum** — reproduzível, é o que se testa;
  - instalação em org **pendente de aprovação** de um owner. *O PI é owner das duas contas (`RodReis`, `RodReis-Team`), então este caso **não ocorre** hoje.* Só passa a existir com membros não-owner ou na versão comercial. **Não construir UI própria para um estado que não se consegue reproduzir** — o estado genérico acima já cobre.
- **Rate limit é por instalação** (5.000/h cada) — duas contas dão o dobro de orçamento, não metade. O `GithubAuth` cacheia um installation token **por instalação**, não por projeto (dois projetos da mesma org compartilham o token).

### Escritas com identidade de bot

- Commits do ProPlan passam a ter autor/committer `proplan[bot]`. **Não revoga o `.proplan/`** (ADR-011): a separação de diretório continua sendo a defesa primária do ADR-010. O autor bot é **segundo sinal, redundante de propósito** — se um dia alguém commitar um artefato gerado no lugar errado, o autor ainda denuncia.
- **ADR-010 ganha robustez de graça**: `lastDocsCommitAt` pode passar a ignorar commits de `proplan[bot]` (a Commits API aceita filtro `author`). **Não implementar nesta fatia** — é redundância; registrar como melhoria disponível.

### Configuração

- Env novo: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (PEM em base64), `GITHUB_APP_SLUG`.
- Env removido: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (do OAuth App). Atualizar `.env.example` e o README.
- Permissões do App (mínimas, ADR-015): `Contents: read & write` · `Issues: read & write` · `Metadata: read` · `Actions: read`. **Nada além.**
- Webhooks do App: **desligados** (ADR-009 — ambiente 100% local). O App já nasce preparado; o gatilho é ligado quando houver endpoint público.

## Fora de escopo

Webhooks (ADR-009). Multi-tenant/RBAC (Fatia 8). Filtro de `lastDocsCommitAt` por autor bot (redundante — registrado como melhoria). Migração de dados de usuários existentes (só existe o PI; reloga e reinstala). GitHub Marketplace/publicação do App.

## Critérios de aceite

- [ ] Login com o GitHub App completa e volta ao app com o usuário logado (avatar e login visíveis) — comportamento idêntico ao anterior para o usuário.
- [ ] Token de usuário expirado é renovado **transparentemente** pelo refresh; falha de refresh derruba a sessão com mensagem clara (nunca 401 cru na UI).
- [ ] Catálogo sem instalação nenhuma mostra o estado vazio com CTA "Instalar no GitHub"; após instalar em 1 repo, o repo aparece ao voltar.
- [ ] Catálogo lista **apenas** repos onde o App está instalado; "Instalar em mais repositórios" leva à tela do GitHub.
- [ ] **Duas contas**: com o App instalado em `RodReis` (pessoal) **e** `RodReis-Team` (org), o catálogo mostra os repos das duas, **agrupados por conta**, com CTA de instalar por grupo.
- [ ] **Instalação sem repositórios acessíveis** (reproduzir: instalar marcando "only select repositories" e não selecionar nenhum) mostra "Nenhum repositório acessível nesta conta — revisar seleção no GitHub" com link. **Nunca lista vazia sem explicação.**
- [ ] O installation token é cacheado **por instalação**: dois projetos da mesma org compartilham o token (não geram dois `access_tokens`).
- [ ] **Um commit feito pelo ProPlan aparece no GitHub com autor `proplan[bot]`, não com o usuário.** É o teste que prova a fatia.
- [ ] Uma issue criada pelo ProPlan é atribuída a `proplan[bot]`.
- [ ] Sync/leitura de docs continua funcionando com o token do usuário (repo privado só é lido se o usuário enxerga).
- [ ] Installation token é cacheado: duas escritas seguidas no mesmo projeto **não** geram dois `access_tokens` (verificável em log/Redis).
- [ ] Remover o App de um repo gerenciado põe o projeto em `sem-instalação`: leitura do cache funciona, escritas desabilitadas, faixa explicativa na UI.
- [ ] Nenhuma leitura usa installation token (teste/lint de arquitetura: `GithubAuth.installationToken` só é chamado pelos caminhos de escrita).
- [ ] `.env.example` e README refletem os novos segredos; o antigo OAuth App não é mais necessário para subir o projeto.

## Contratos

- `identity`: `GithubAuth.userToken(userId)` · `GithubAuth.installationToken(projectId)` · `GithubAuth.installationsOf(userId)`.
- Prisma: `User` troca `encryptedGithubToken` por `encryptedUserToken` + `encryptedRefreshToken` + `tokenExpiresAt`. `Project` ganha `installationId Int?` e `installationStatus active|missing`. Migration com backfill trivial (só o PI existe).
- API: `GET /auth/github` (agora OAuth do App) · `GET /auth/github/callback` · `GET /auth/me` · `POST /auth/logout` — **assinaturas inalteradas**. Novo: `GET /catalog/installations` · `GET /catalog/install-url`.
- `AuthService.githubTokenOf` (usado por `ingestion`, `insight`, `board`) é **substituído** por `GithubAuth.userToken` / `.installationToken`. Todos os call sites migram.

## Notas técnicas

- **JWT do App**: RS256 com a chave privada; `exp` ≤ 10 minutos (o GitHub rejeita mais). Relógio adiantado quebra o JWT — usar `iat` com 60s de folga para trás. É a pegadinha clássica.
- **Chave privada em env**: PEM tem quebras de linha; guardar **base64** e decodificar na leitura. `.env` fora do git (já está no `.gitignore`).
- **Octokit continua descartado** (nota da SPEC-001: v4+ é ESM-only, conflita com o build CJS do Nest). JWT com `jsonwebtoken`, resto via `fetch`.
- **Callback local**: GitHub App aceita `http://localhost` como callback — o fluxo funciona 100% local, sem túnel (o túnel só seria necessário para webhook, que está desligado pelo ADR-009).
- **Rate limit** passa a ser por instalação (5.000/h) além do do usuário. Manter ETag/backoff da resiliência atual — não relaxar.
- **Ordem de implementação**: `identity` primeiro (com testes de `GithubAuth`), depois migrar os call sites, depois o `catalog`. As escritas (`board`) só existem na Fatia 5 — nesta fatia o único consumidor de `installationToken` é o write-back do `insight` (bootstrap), que serve de prova viva do critério de aceite do autor bot.

## Perguntas abertas

Nenhuma. Decidido com o PI em 2026-07-12: GitHub App agora, aproveitando o reconsentimento que a Fatia 5 exigiria de qualquer forma ✔ · dois tokens, leitura com o do usuário e escrita com o da instalação ✔ · atrito de instalação por repo aceito (é consentimento explícito — requisito de uma versão comercial) ✔
