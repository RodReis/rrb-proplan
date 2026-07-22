---
proplan: v1
spec: SPEC-028
fatia: URLs legíveis (UX de roteamento) — pós-MVP
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-22 # + esclarecimentos de implementação (módulo, arch test, 404×403)
---
# SPEC-028 — URLs legíveis: slug de tenant e projeto em vez de UUID

> **Refinamento da SPEC-022 §4, não contradição.** A rota escopada continua sendo
> `/t/:tenant/…` e o catálogo continua em `/` (SPEC-021). Só o **token** de tenant
> e de projeto deixa de ser UUID e vira slug legível. RLS, contexto por array de
> membership (ADR-020) e escopo por tenant permanecem **intactos** — a resolução
> entrega o mesmo `tenantId` que a sessão já usava. Aprovada pelo PI em 2026-07-22
> ("vai na recomendação"); ver *Perguntas abertas → Resolvidas*.

## Objetivo

Trocar a URL do workspace de
`/t/00000000-0000-4000-8000-e48e206abe39/p/402e31cc-0895-40c1-a5a3-b0408ca442df/kanban`
por `/t/rodreis/p/rrb-proplan/kanban` — legível, compartilhável e igual ao que o
breadcrumb já mostra (`RodReis / rrb-proplan / Kanban`) — **sem** mudar schema nem
o modelo de isolamento.

## Escopo

1. **Rota vira slug**: `/t/:tenantSlug/p/:projectSlug/:tab`, com
   `/t/:tenantSlug/p/:projectSlug` → aba padrão (o `RedirectToDefaultTab` atual
   segue, só passa a preservar slug).
   - `tenantSlug` = `Tenant.accountLogin` em **lowercase**.
   - `projectSlug` = `Project.name` (o nome do repo).
2. **Endpoint de resolução** `GET /resolve` que traduz `(tenantSlug, projectSlug)`
   → `{ tenantId, projectId, tenantSlug, projectSlug }`, **sob RLS** do usuário
   autenticado (não-membro / inexistente → **404**, nunca vaza). Aceita **UUID**
   em qualquer segmento de forma **idempotente** (UUID entra → mesmo id sai).
3. **Back-compat por forma do token**: URL antiga com UUID resolve normalmente e a
   app **reescreve** (`history.replace`) para a forma slug. **Bookmark antigo com
   UUID nunca quebra**; o novo é bonito.
4. **Web**: as rotas de `App.tsx` passam a `/:tenantSlug`/`:projectSlug`;
   `WorkspaceRoute` **resolve no mount** (deep-link/F5) e usa os **ids** internamente;
   `TenantSync` fixa `setActiveTenant(tenantId)` — o **id resolvido**, não o slug
   (o contrato de escopo da SPEC-022 não muda).
5. **Zero migration**: `accountLogin` e `Project.name` já existem; a identidade
   continua nos campos estáveis (`Tenant.accountId`/`id`, `Project.githubRepoId`/`id`).
   Nenhuma coluna nova, nenhum `nanoid`.
6. **Atualização de documentos** (escopo obrigatório da entrega, não "melhoria
   adjacente"): nota de refinamento na SPEC-022 §4, `docs/ARCHITECTURE.md`
   (roteamento), `docs/STATUS.md` (já registrado no Índice), `docs/DEVELOPMENT.md`.

## Fora de escopo

- **Rename-redirect** (persistir slugs antigos para redirecionar). Rename de
  conta/repo no GitHub muda o slug canônico **no próximo sync**; bookmark do slug
  **antigo** dá 404 amigável; bookmark por **UUID** sempre resolve. Guardar o
  histórico de slug é fatia futura, só se a dor aparecer.
- **Dropar os prefixos `/t/`·`/p/`** (URL estilo `/owner/repo`): colidiria com a
  rota global `/` (catálogo) e futuras top-level; a SPEC-022 §4 fixa `/t/:tenant`.
  O incômodo do PI é o UUID gigante, não os dois prefixos curtos.
- **Short id opaco** (base62/nanoid): desnecessário — o nome do repo já é legível
  e não exige coluna nova. Recusado a favor do slug por nome.
- **Mudar RLS / array de contexto (ADR-020) / escopo por tenant**: a resolução só
  entrega o `tenantId`; o isolamento é o mesmo da SPEC-022.
- **Subdomínio por tenant**: já fora na SPEC-022 (DNS wildcard + TLS).

## Critérios de aceite

- [ ] `/t/rodreis/p/rrb-proplan/kanban` abre o **mesmo** workspace que a URL de
  UUID abria; a barra de endereço mostra a forma **slug**.
- [ ] F5 e link direto na forma slug preservam **tenant + projeto + aba** — a
  resolução do deep-link acontece **sem** baixar o catálogo global inteiro.
- [ ] URL antiga com UUID (`/t/<uuid>/p/<uuid>/kanban`) **ainda abre** e é reescrita
  para a forma slug — bookmark antigo não quebra.
- [ ] Slug (ou UUID) de tenant a que o usuário **não pertence** → **404 amigável**,
  nunca um registro do tenant (mesma garantia da SPEC-022; `/resolve` sob RLS).
- [ ] Projeto inexistente sob um tenant válido → **404 amigável**.
- [ ] Match **case-insensitive**; a URL canônica é lowercase
  (`/t/RodReis/p/RRB-ProPlan/…` reescreve para `/t/rodreis/p/rrb-proplan/…`).
- [ ] Trocar de tenant/projeto limpa o estado do anterior (mantém o critério da
  SPEC-022 — nada de A aparece depois de entrar em B).
- [ ] **Nenhuma migration** no diff. Teste que prova resolução por **id estável**:
  simular rename do repo (muda `name`) → a URL por UUID/id continua abrindo.

## Contratos

- `GET /resolve?tenant=<slug|uuid>&project=<slug|uuid>`
  → `200 { tenantId, projectId, tenantSlug, projectSlug }` | `404`.
  - Roda no **contexto RLS** do usuário autenticado; o array de membership deriva
    do `userId` da sessão (SPEC-022/ADR-020), **jamais** de input do cliente.
  - `tenantSlug` casa `Tenant.accountLogin` (case-insensitive); `projectSlug` casa
    `Project.name` dentro do tenant; **UUID** casa `id`. A resposta carrega os ids
    canônicos e os slugs canônicos (lowercase).
- **Web** (`apps/web`): rotas de `/t/:tenant/p/:projectId/:tab` para
  `/t/:tenantSlug/p/:projectSlug/:tab`; `WorkspaceRoute` resolve no mount e injeta
  ids; `TenantSync` chama `setActiveTenant(tenantId)` (o resolvido).
- **Sem** modelo novo, **sem** coluna, **sem** migration.

## Notas técnicas

- **Por que resolver por id estável e não guardar por slug**: `accountLogin` e
  `Project.name` são **mutáveis** (rename no GitHub). O casamento de leitura é por
  eles, mas a **identidade** continua em `Tenant.accountId`/`id` e
  `Project.githubRepoId`/`id` — os mesmos estáveis que a SPEC-022 (Escopo 1) e a
  #89 (`accountId`) já escolheram. Repetir o erro do "login como identidade" aqui
  seria reintroduzir a instabilidade que a PK própria corrige.
- **Back-compat por forma do token**: detectar UUID por shape (regex) → casa `id`;
  senão casa slug. Evita coluna de tipo. A app faz `history.replace` para a forma
  slug ao entrar por UUID — velho vive, novo é bonito.
- **Unicidade (invariante testada)**: `accountLogin` é único no GitHub (1 login =
  1 conta = 1 tenant, 1:1 na SPEC-022); `Project.name` é único **dentro da conta**
  (o GitHub garante nome único por owner, e tenant = 1 conta) → `(tenant, name)`
  resolve sem ambiguidade.
- **Endpoint de resolução em vez de derivar do catálogo**: deep-link/F5 em
  `/t/x/p/y` não deve baixar o catálogo global inteiro só para achar 2 ids. Um
  `GET /resolve` barato faz isso sob RLS. *Fail-closed* preservado: sem
  contexto/membership → 404 (não vaza existência de tenant/projeto alheio).
- **SPEC-022 §4 intacta**: `/t/:tenant` permanece, o catálogo em `/` permanece;
  muda só o token. ADR-020, RLS e `withTenant` não são tocados.
- **Módulo e padrão de implementação**: `/resolve` mora no `catalog` (é onde
  vivem `MembershipService` e o acesso a `projects` sob RLS). O handler reusa o
  padrão do `listProjects` — `membershipTenantIds(userId)` monta o array de
  contexto e `prisma.withTenant([...], tx => …)` faz a leitura. Não é rota
  escopada: **não** passa pelo `TenantGuard`/`TenantContextInterceptor`; abre o
  próprio contexto, como o resto do catálogo (ADR-020). Resolver o tenant no
  `identity` e o projeto no `catalog` seria over-engineering para um endpoint
  barato — um método só, no `catalog`.
- **Teste de arquitetura estendido**: o método global novo (`resolveSlugs` ou
  similar) entra em `GLOBAL_METHODS` do `global-route-scope.arch.spec.ts`, para a
  mesma varredura garantir que todo acesso a tabela escopada passa por
  `withTenant` (o `noop` fail-closed do RLS morde silencioso fora do contexto).
- **404 no `/resolve` × 403 no `TenantGuard` — convivência deliberada, não
  contradição**: são endpoints diferentes com jobs diferentes, e **ambos são
  não-diferenciais**. O `TenantGuard` dá 403 sempre que não há membership — tanto
  para "tenant existe, não sou membro" quanto para "tenant não existe" — então o
  403 não vaza existência; o 404 do `/resolve` também não. Pelo fluxo slug o
  não-membro bate no 404 do `/resolve` antes de chegar ao 403 (que exige forjar
  uma URL com UUID de tenant real — justamente o que o `/resolve` se recusa a
  entregar). Sem regressão: o 403 é contrato entregue da SPEC-022, **fora do
  escopo desta fatia**, e não se toca. A divergência é só de código de status em
  rotas distintas — um comentário curto no handler do `/resolve` documenta a
  escolha; **ADR seria overkill** (não há decisão estrutural, só esclarecimento
  de contrato).

## Perguntas abertas

Nenhuma que bloqueie. **Resolvidas com o PI em 2026-07-22** ("vai na recomendação")
— reverter se o PI discordar:

- **Fonte do slug** → tenant = `accountLogin`, projeto = `name` (o que o breadcrumb
  já mostra). Short-id opaco recusado: exigiria coluna e é menos legível.
- **Rename** → o slug canônico segue o novo nome no próximo sync; bookmark do slug
  antigo dá 404; bookmark por UUID sempre abre. Persistir histórico de slug
  (redirect no rename) fica **fora** — fatia futura se a dor aparecer.
- **Prefixos `/t/`·`/p/` mantidos** (não virar `/owner/repo`): a SPEC-022 §4 os
  fixa e a rota global `/` precisa deles para desambiguar.
