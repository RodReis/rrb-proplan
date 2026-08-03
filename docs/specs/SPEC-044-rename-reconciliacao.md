---
proplan: v1
spec: SPEC-044
fatia: 33
status: aprovada-pi
updated: 2026-08-03
---
# SPEC-044 — Rename de conta e de repositório: reconciliação por id

## Objetivo

Renomear a conta do GitHub (ou um repositório) deixa de congelar o ProPlan num nome que não existe mais: `owner`/`name` do projeto e o repo source do licenciamento passam a ser reconciliados pelo **id numérico**, a única chave estável que o GitHub expõe.

## Contexto (o que quebra hoje)

O schema já foi desenhado para rename — `Tenant.accountId`, `User.githubId`, `Project.githubRepoId` são ids, e o `tenant-reconcile.ts` diz por escrito que *"o login muda num rename"*. O que ficou de fora é o **texto derivado desses ids**:

1. **`projects.owner` e `projects.name` só são gravados no `create`.** Em `catalog.service.ts`, o ramo `update` do upsert toca apenas `installationId`/`installationStatus`. Depois de um rename, o valor no banco aponta para um dono que não existe mais — e é dele que saem todas as chamadas: `github-git.client.ts` monta `/repos/${owner}/${repo}/...` em dez lugares, mais writeback, board e MCP.
2. **A REST do GitHub redireciona (301), a GraphQL não.** O board de issues consulta `repository(owner:$owner,name:$repo)` (`github-issues.client.ts`) — esse é o caminho que falha primeiro, e falha em silêncio.
3. **`LicProduct.sourceRepo` é texto puro** (`dono/nome`, validado só no formato). É caminho de cliente pagante: convite e revogação de colaborador usam `PUT`/`DELETE` sobre esse texto, e redirect em método não-GET não é garantia.
4. **O redirect é temporário por natureza.** O nome antigo fica livre para qualquer um reivindicar; se alguém criar um repo homônimo, o redirect morre e o valor congelado passa a apontar para o repositório de outra pessoa.

## Escopo

- **Reconciliação do projeto no catálogo (custo zero de rede).** `listInstallationRepos` já devolve `id`, `owner.login` e `name`. O upsert de `addProject` e a listagem passam a regravar `owner`/`name` quando divergirem do que veio do GitHub para o mesmo `githubRepoId`.
- **Reconciliação do projeto no sync (caminho automático).** No início de `runSync`, resolver o repositório por id — `GET /repositories/{githubRepoId}` — e regravar `owner`, `name` e `defaultBranch` antes de qualquer outra chamada. Uma requisição por sync; todas as chamadas seguintes usam o valor recém-confirmado.
- **`LicProduct.sourceRepoId`** (`BigInt?`): id numérico do repo source. **Backfill oportunista** — `checkRepoAccess` já faz `GET /repos/{repo}` e a resposta traz `id` e `full_name`; grava os dois na mesma ida. Nenhuma chamada de rede nova no `PATCH` do produto.
- **Reconciliação do source por id.** Com `sourceRepoId` preenchido, resolver por `GET /repositories/{id}` e regravar `sourceRepo` quando o `full_name` divergir.
- **Pendência quando não dá para corrigir.** `sourceRepoId` ausente (nunca verificado) ou resolução por id devolvendo 404 → pendência legível na área de licenciamento, no mesmo lugar em que a SPEC-039/040 já mostra pendências de source e PAT. Nunca corrigir por adivinhação de nome.
- **Reconciliação é silenciosa.** Rename é fato do GitHub, não evento de negócio: atualiza e segue, sem `AuditEvent` e sem entrada na Atividade. O que aparece ao operador é só a **pendência** do item acima.

## Fora de escopo

- **Histórico de logins anteriores e redirect de URL.** `/t/:tenantSlug` segue derivando do `accountLogin` corrente; link antigo responde 404. Decisão do PI (2026-08-03): não introduzir estado novo para bookmark de um usuário único.
- Reconciliação de `licenses.githubUsername` (login do comprador) — rename de terceiro é outro problema, com outro gatilho.
- Migração de dados one-off para o rename em curso: a reconciliação automática regrava no primeiro catálogo ou sync; `sourceRepo` é corrigido pela pendência.
- `test-report.config.json`, README e `git remote` — texto de repositório, não comportamento de produto. Entram como ajuste no PR, não como critério de aceite.

## Critérios de aceite

- [ ] Projeto cujo `owner` no banco diverge do GitHub para o mesmo `githubRepoId` é regravado ao listar o catálogo, sem requisição adicional.
- [ ] `runSync` de projeto com `owner` defasado resolve por id, regrava `owner`/`name`/`defaultBranch` e completa o sync — incluindo o board por GraphQL, que hoje falharia.
- [ ] Repositório renomeado (mesmo dono, nome novo) também é reconciliado — o casamento é por id, não por owner.
- [ ] `GET /repositories/{id}` respondendo 404 não apaga nem corrompe o projeto: o sync falha com motivo legível e o registro fica intacto.
- [ ] `checkRepoAccess` grava `sourceRepoId` e o `full_name` corrente na primeira execução bem-sucedida.
- [ ] Produto com `sourceRepoId` preenchido e `sourceRepo` defasado tem o texto regravado; convite e revogação passam a usar o nome novo.
- [ ] Produto sem `sourceRepoId`, ou com id que devolve 404, aparece como pendência na área de licenciamento com motivo legível — e nenhuma correção automática é tentada.
- [ ] Nenhum `AuditEvent` é emitido por reconciliação de rename.

## Contratos

- Prisma: `LicProduct.sourceRepoId BigInt? @map("source_repo_id")`. Sem `@unique` — dois produtos do mesmo tenant podem apontar para o mesmo repo source.
- `GithubGitClient.getRepoById(token, githubRepoId)` → `{ owner, name, defaultBranch } | null` (`null` no 404).
- `GithubSourceClient.checkRepoAccess` passa a devolver, no caso `ok`, também `{ repoId, fullName }`.
- Nenhum endpoint HTTP novo. A pendência entra na resposta já existente da área de licenciamento.

## Notas técnicas

- **`/repositories/{id}` é a rota certa** — endpoint por id, distinto de `/repos/{owner}/{name}`. Não depende de nome nenhum, que é o ponto.
- **Uma requisição por sync é o preço aceito.** A alternativa — tratar 404 em cada um dos dez call sites e só então resolver por id — economiza rede e espalha a mesma decisão por dez lugares. Simplicidade primeiro (CLAUDE.md): resolve uma vez, no início, e o resto do sync roda com valor confirmado.
- **Não confiar no redirect da REST.** Ele existe, mas é revogável por terceiro (nome antigo reivindicado) e não cobre GraphQL. A reconciliação não é otimização: é o que impede o ProPlan de escrever no repositório errado.
- **ADR-015 intacto:** leitura com user-to-server, escrita com installation token. `getRepoById` é leitura e usa o token do usuário, como o resto do `GithubGitClient`. O source do licenciamento continua no `githubPat` do tenant (SPEC-039).
- **Verificação prévia de produção (operacional, não código):** `tenants.account_id` precisa estar preenchido antes de qualquer rename de conta. Linha pré-migration com `account_id` nulo cai no fallback por login do `tenant-reconcile.ts` — exatamente o que um rename quebra.
- Risco conhecido: um rename entre o `listInstallationRepos` e o `runSync` faz o sync resolver o valor novo por id e prosseguir — a janela existe e é fechada pela própria resolução no início do run.

## Perguntas abertas

Nenhuma. As três decisões de produto foram resolvidas com o PI em 2026-08-03: escopo total (projeto + source com pendência), URL antiga responde 404 sem histórico, reconciliação silenciosa.
