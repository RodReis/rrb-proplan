---
proplan: v1
spec: SPEC-022
fatia: 8
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-17
---
# SPEC-022 — Multi-tenant: organizações, RBAC e isolamento (Fatia 8)

> Fecha o "sem escopo" da Fatia 8 (issue #7). Aprovada pelo PI em 2026-07-17 — ver *Perguntas abertas → Resolvidas*.

## Objetivo

Transformar o ProPlan de usuário único (MVP) em multi-tenant: mais de uma pessoa opera o painel, projetos pertencem a um **tenant** (não a um indivíduo), e o acesso a cada projeto é mediado por papéis. Habilita comercialização (motivo já registrado no ADR-015).

## Contexto herdado (não é decisão nova — já está nos ADRs)

- **ADR-015** já preparou o terreno: GitHub App com **rate limit por instalação** ("escala para multi-tenant sem mudança"), identidade `proplan[bot]` para escritas, Catálogo listando "repos onde o App está instalado". Cada tenant **vincula-se 1:1 a uma instalação**, mas é entidade própria do ProPlan (ver Escopo 1).
- **ADR-006/007**: o módulo `identity` nasceu mínimo (login/logout/me); "RBAC e multi-tenant continuam na Fatia 8". Este é o momento.
- **ADR-001**: se multi-tenant exigir streaming/fan-out real, o ADR-004 (BullMQ, sem Kafka) **deve ser revisado**. O primeiro corte não exige — registrar se vier a exigir.
- **ADR-016**: o teto de gasto de IA é hoje global; passa a ser **por tenant**.
- **Ambiente 100% local** (CLAUDE.md) até o fim do MVP: decide o roteamento por path (subdomínio exigiria DNS wildcard + TLS, que não temos localmente).

## Escopo

1. **Tenant é entidade própria do ProPlan, vinculada 1:1 a uma instalação do App**: a tabela `Tenant` tem **PK própria** (gerada pelo ProPlan) e um campo `installationId` que aponta para a instalação. É dona de projetos, membros e teto de IA; todo dado de projeto ganha `tenant_id` (FK para a PK do `Tenant`, **nunca** para o id de instalação). **Por que não usar o id da instalação como identidade**: o id de instalação do GitHub **não é estável** — desinstalar e reinstalar o App emite um id **novo**. Com PK própria, um reinstall só **re-aponta** `installationId` no mesmo `Tenant` e nenhum dado orfana. No 1º corte a relação é **1:1** (um tenant = uma instalação = uma org); a PK própria só **não fecha a porta** para 1 tenant → N instalações no futuro — **sem mudar o comportamento aprovado**.
2. **Membros e papéis (RBAC)** derivados do GitHub: quem tem acesso à conta/organização da instalação é membro; o papel deriva da permissão do GitHub (administrador da org/repo → `owner`; demais com acesso → `member`; sem escrita → `viewer`). Papéis:
   - `owner` — gerencia/remove projeto, administra membros, e é **o único que pode aceitar/finalizar** issue (o ato do dono, ADR-011).
   - `member` — opera o board (mover cards, escrever), dispara sync, vê custo de IA.
   - `viewer` — só leitura.
3. **Isolamento em profundidade** (três barreiras, não uma):
   - (a) **escopo por tenant na aplicação** — toda query de projeto nasce escopada; a barreira primária, ergonômica;
   - (b) **Row-Level Security no Postgres** — a rede que corta a query que **esqueceu** o filtro. **Onde `tenant_id` mora é decisão de implementação, não de produto**: o corte recomendado é coluna nas **raízes** (`Project` + tabelas sem projeto, como `Settings` e `LlmUsage`) e **policy por join** nas ~13 filhas em cascade; denormalizar `tenant_id` para todas é o caminho de escala se os planos de RLS-com-join degradarem (barato, porque `tenant_id` é imutável por projeto);
   - (c) **teste de auditoria no CI** — barra o merge de query de projeto sem escopo de tenant.
   A visibilidade real do GitHub (leitura via **user-to-server token**, ADR-015) é uma quarta barreira, herdada.
4. **Roteamento por path** (`/t/:tenant/…`) e seleção do tenant ativo na sessão. Subdomínio fica fora: exigiria DNS wildcard + TLS, inviável no **ambiente 100% local** (CLAUDE.md) — não tem relação com o ADR-009.
5. **Migração do usuário único**: os dados atuais viram o **tenant pessoal** do dono (instalação pessoal), sem perda.
6. **Teto de IA por tenant**: o ledger e o teto do ADR-016 passam a ser escopados por `tenant_id`.

## Fora de escopo

- **Billing/cobrança real** (Stripe, assentos, planos) — **fatia própria posterior** (decisão do PI). Esta fatia entrega isolamento + RBAC sem cobrança.
- Papel `admin` separado de `owner` — só faz sentido com billing; entra com a fatia de billing.
- SSO corporativo, SCIM, convite por e-mail fora do GitHub — a fonte de membros é o GitHub (item 2). Reabrir só se essa fonte mudar.
- Mudança no fluxo de auth do GitHub App (ADR-015 permanece).
- Subdomínio por tenant (fica para deploy em nuvem, quando houver DNS/TLS).
- Webhooks (ADR-009 mantém: sem webhooks enquanto local).

## Critérios de aceite

> Verificáveis um a um. Cada critério diz **setup → ação → resultado observável** e o método. "Funciona" não é critério.

**Isolamento por RLS (a fronteira de segurança)**

- [ ] Setup: tenants A e B, cada um com ≥1 projeto e um usuário membro. Autenticado como membro de A, `GET /t/A/projects` lista **só** projetos de A; `GET /t/B/projects` retorna **403** (não-membro) — nunca um único registro de B em nenhum campo da resposta.
- [ ] A RLS protege **abaixo** da aplicação, não só nela: com o role de aplicação do Postgres e **sem** `app.tenant_id` setado no contexto, um `SELECT` direto em `projects`/`issues`/`ai_ledger`/`insights` devolve **zero linhas** — nenhuma tabela de projeto responde sem o tenant no contexto.
- [ ] Teste de regressão deliberado: uma query de projeto escrita **sem** cláusula de `tenant_id` (simulando o bug humano) **não vaza** — a policy RLS corta. O teste que prova isso fica versionado e nomeado.
- [ ] Checagem automatizada no build: **toda** tabela com dado de tenant tem **policy RLS habilitada** (não inspeção manual). A coluna `tenant_id` própria é exigida só nas raízes (`Project` + tabelas sem projeto); as filhas podem herdar por join — mas **nenhuma** tabela de projeto pode ficar sem policy.
- [ ] O contexto do tenant é **transaction-scoped**: uma segunda request que reusa a conexão do pool **não herda** o `tenant_id` da anterior (provado forçando reuso de conexão e observando isolamento — o `SET LOCAL` morreu no commit da tx anterior).

**RBAC (papéis)**

- [ ] `viewer` de um tenant: a UI **não renderiza** os controles de mover card/finalizar/administrar; **e** `PATCH`/`POST` de board retornam **403**. Verificar os dois lados (front esconde, API recusa) — defesa em profundidade.
- [ ] `member`: move card e escreve no board com sucesso (200); tentar **finalizar** issue ou **administrar membros** retorna **403**.
- [ ] `owner`: finaliza issue e administra membros com sucesso; a finalização posta o carimbo na issue exatamente como hoje (ADR-011).

**Aceite/finalização sob multi-tenant (ADR-011)**

- [ ] Só o `owner` fecha issue como `proplan:finalizado`, e só por ação deliberada. Tentativa por `member`/`viewer` = 403. **Nenhuma** automação (sync, write-back de card, job) finaliza — provado tentando disparar cada caminho e observando que a issue permanece aberta.

**Migração do usuário único**

- [ ] Após migrar, o dono atual vê **todos** os seus projetos, issues (cache), ledger de IA e insights intactos, agora dentro do tenant pessoal. Contagem por tabela **antes = depois** (query de conferência).
- [ ] A migração é **idempotente**: rodar duas vezes não duplica `Tenant` nem `Membership` (conferir por contagem).

**Teto de IA por tenant (ADR-016)**

- [ ] O painel de custo mostra gasto/teto do **tenant ativo**; trocar de tenant troca os números exibidos.
- [ ] Estourar o teto do tenant A **bloqueia** inferência em A (a próxima chamada é recusada com mensagem de teto) e **não** afeta B — B segue inferindo no mesmo intervalo.

**Roteamento por path**

- [ ] F5 em `/t/:tenant/p/:id/kanban` volta ao **mesmo** tenant, projeto e aba.
- [ ] Trocar de tenant limpa o estado do anterior: nenhum projeto/board de A aparece após entrar em B (inspeção da tela + rede).
- [ ] Abrir URL de um tenant a que o usuário **não** pertence → 403/404 amigável, nunca dado do tenant.

**Derivação de papel a partir do GitHub**

- [ ] Remover o acesso de um usuário ao repo/org no GitHub → **no próximo sync** o papel dele cai (perde escrita); a UI e a API passam a recusar as ações que ele tinha. Verificado ponta a ponta.

## Contratos (esboço — assinaturas, não implementação)

- Modelo: `Tenant { id (PK própria), installationId (link 1:1, re-apontável no reinstall) }`, `Membership { userId, tenantId, role }`. `Project`, `Issue`(cache), `AiLedger`, `Insight` ganham `tenantId` (FK para `Tenant.id`).
- Policies RLS por tabela, escopadas a `current_setting('app.tenant_id')` — direto nas raízes, por join a `Project` nas filhas. O `app.tenant_id` é setado com **`SET LOCAL` dentro de uma transação interativa por request** (nunca `SET` de sessão — vazaria no pool).
- `identity` expõe `currentMembership()` e um guard de papel para os outros módulos (interface pública, sem vazar entidade — ADR-001).

## Notas técnicas

- **RLS**: roda em Postgres puro (dev local) e Supabase; o custo registrado é complicar migração/seed — o `prisma/seed.ts` precisa setar o tenant de contexto. Aceito pelo PI como preço da fronteira de segurança forte.
- **Prisma + pool + RLS (risco conhecido — não repetir o erro)**: `SET app.tenant_id` de **sessão** vaza entre requests que reusam a conexão do pool. O contexto tem de ser **transaction-scoped**: `SET LOCAL` dentro de uma transação interativa por request (via client extension do Prisma), morrendo no commit/rollback. É o padrão documentado Supabase/Prisma. O critério de aceite de "transaction-scoped" existe para provar que essa armadilha foi evitada.
- **Placement de `tenant_id` (raízes vs. toda tabela)**: começar nas raízes (`Project` + órfãs) + join nas filhas é o menor diff; denormalizar `tenant_id` para as ~13 filhas é a saída se o join na policy pesar nos planos — migração barata porque `tenant_id` é **imutável** por projeto (write-once, sem risco de drift).
- **Reinstall re-liga, não recria**: quando uma instalação é removida e recriada, o sync deve reconhecer o `Tenant` existente (por conta/org) e **re-apontar** `installationId` para o novo id — nunca criar um `Tenant` duplicado nem orfanar os dados do antigo. Vale um critério de teste na implementação.
- **Papel derivado do GitHub** evita um segundo sistema de convite; o preço é acoplar o acesso ao GitHub — reversível no dia em que SSO entrar.
- Revisar **ADR-004** só se o primeiro corte exigir fan-out entre tenants (improvável).

## Perguntas abertas

Nenhuma. **Resolvidas com o PI em 2026-07-17:**

- **Billing** → **fora**, fatia própria posterior (não incha esta com cobrança).
- **Tenant** → **entidade própria do ProPlan, vinculada 1:1 a uma instalação** (PK própria, `installationId` re-apontável). Comportamento 1:1 no 1º corte, como aprovado; a PK própria só evita orfanar dado no reinstall e não fecha a porta para N instalações. (A redação anterior "Tenant = instalação" era ambígua — corrigida em 2026-07-17 após o Claude Code apontar a divergência com o schema Prisma.)
- **Isolamento** → **em profundidade**: `tenant_id` + escopo na app (barreira primária) · **RLS** (rede de segurança) · **teste de auditoria no CI**. (A redação anterior "RLS no Postgres" encolheu o combinado; RLS é a rede, não a única barreira — corrigida em 2026-07-17.)
- **Confronto de stack** → n/a (é da SPEC-023).

Resolvidas **por derivação** (travadas por ADR/contexto já existente; reverter se o PI discordar):

- **Fonte dos membros/papel** → **derivado do GitHub** (decorre de tenant vinculado à instalação; adia SSO/SCIM, listado em Fora de escopo).
- **Roteamento do tenant** → **path `/t/:tenant`**; subdomínio inviável no ambiente 100% local (CLAUDE.md) — DNS wildcard + TLS. (A citação anterior ao ADR-009 era lapso meu; ADR-009 é sobre webhooks — corrigida em 2026-07-17.)
- **Papéis** → **`owner` / `member` / `viewer`**; só `owner` finaliza (ADR-011); `admin` adiado para a fatia de billing.
