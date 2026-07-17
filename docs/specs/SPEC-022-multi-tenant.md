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

- **ADR-015** já preparou o terreno: GitHub App com **rate limit por instalação** ("escala para multi-tenant sem mudança"), identidade `proplan[bot]` para escritas, Catálogo listando "repos onde o App está instalado". A **instalação do App** é a fronteira de tenancy (decisão confirmada abaixo).
- **ADR-006/007**: o módulo `identity` nasceu mínimo (login/logout/me); "RBAC e multi-tenant continuam na Fatia 8". Este é o momento.
- **ADR-001**: se multi-tenant exigir streaming/fan-out real, o ADR-004 (BullMQ, sem Kafka) **deve ser revisado**. O primeiro corte não exige — registrar se vier a exigir.
- **ADR-009**: sem webhooks enquanto o ambiente for local — pesa na escolha de roteamento do tenant (path, não subdomínio).
- **ADR-016**: o teto de gasto de IA é hoje global; passa a ser **por tenant**.

## Escopo

1. **Tenant = instalação do GitHub App**: entidade `tenant` espelha uma instalação do App. É dona de projetos, membros e teto de IA. Todo dado de projeto passa a ter `tenant_id`.
2. **Membros e papéis (RBAC)** derivados do GitHub: quem tem acesso à conta/organização da instalação é membro; o papel deriva da permissão do GitHub (administrador da org/repo → `owner`; demais com acesso → `member`; sem escrita → `viewer`). Papéis:
   - `owner` — gerencia/remove projeto, administra membros, e é **o único que pode aceitar/finalizar** issue (o ato do dono, ADR-011).
   - `member` — opera o board (mover cards, escrever), dispara sync, vê custo de IA.
   - `viewer` — só leitura.
3. **Isolamento por RLS no Postgres**: `tenant_id` em todas as tabelas de projeto + **Row-Level Security** garantindo que nenhuma query sirva dado de tenant a que o usuário logado não pertence. A visibilidade real do GitHub (leitura via **user-to-server token**, ADR-015) é a segunda barreira.
4. **Roteamento por path** (`/t/:tenant/…`) e seleção do tenant ativo na sessão. Subdomínio fica fora (exige DNS/wildcard — conflita com o ADR-009 enquanto local).
5. **Migração do usuário único**: os dados atuais viram o **tenant pessoal** do dono (instalação pessoal), sem perda.
6. **Teto de IA por tenant**: o ledger e o teto do ADR-016 passam a ser escopados por `tenant_id`.

## Fora de escopo

- **Billing/cobrança real** (Stripe, assentos, planos) — **fatia própria posterior** (decisão do PI). Esta fatia entrega isolamento + RBAC sem cobrança.
- Papel `admin` separado de `owner` — só faz sentido com billing; entra com a fatia de billing.
- SSO corporativo, SCIM, convite por e-mail fora do GitHub — a fonte de membros é o GitHub (item 2). Reabrir só se essa fonte mudar.
- Mudança no fluxo de auth do GitHub App (ADR-015 permanece).
- Subdomínio por tenant, webhooks (ADR-009 mantém).

## Critérios de aceite

- [ ] Dois usuários em tenants (instalações) distintos não enxergam os projetos um do outro por **nenhuma** rota — verificado com o token de cada um; a RLS recusa mesmo se uma query esquecer o filtro.
- [ ] Um `viewer` não move card nem finaliza issue: a UI esconde **e** a API recusa (defesa em profundidade).
- [ ] Só o `owner` aceita/finaliza issue (ADR-011); nenhuma automação forja aceite mesmo com multi-tenant.
- [ ] Os dados do usuário único atual aparecem intactos no seu tenant pessoal após a migração.
- [ ] O teto de gasto de IA é aplicado e exibido por tenant; estourar o teto de um tenant não afeta outro.
- [ ] Nenhuma tabela de projeto/board/insight/ledger sem `tenant_id` e sem policy RLS (verificável por migração + teste).
- [ ] Roteamento `/t/:tenant/…`: F5 mantém tenant e projeto; trocar de tenant não vaza estado do anterior.
- [ ] A derivação de papel a partir do GitHub é reavaliada a cada sync (quem perdeu acesso ao repo perde o papel).

## Contratos (esboço — assinaturas, não implementação)

- Modelo: `Tenant { installationId }`, `Membership { userId, tenantId, role }`. `Project`, `Issue`(cache), `AiLedger`, `Insight` ganham `tenantId`.
- Policies RLS por tabela, escopadas a `current_setting('app.tenant_id')` (ou equivalente), setado por request após resolver o tenant ativo.
- `identity` expõe `currentMembership()` e um guard de papel para os outros módulos (interface pública, sem vazar entidade — ADR-001).

## Notas técnicas

- **RLS**: roda em Postgres puro (dev local) e Supabase; o custo registrado é complicar migração/seed — o `prisma/seed.ts` precisa setar o tenant de contexto. Aceito pelo PI como preço da fronteira de segurança forte.
- **Papel derivado do GitHub** evita um segundo sistema de convite; o preço é acoplar o acesso ao GitHub — reversível no dia em que SSO entrar.
- Revisar **ADR-004** só se o primeiro corte exigir fan-out entre tenants (improvável).

## Perguntas abertas

Nenhuma. **Resolvidas com o PI em 2026-07-17:**

- **Billing** → **fora**, fatia própria posterior (não incha esta com cobrança).
- **Tenant** → **instalação do GitHub App** (coerente com ADR-015; um tenant não abrange várias orgs — aceito).
- **Isolamento** → **RLS no Postgres** (fronteira de segurança à prova de query esquecida; aceito o custo em migração/seed).
- **Confronto de stack** → n/a (é da SPEC-023).

Resolvidas **por derivação** (travadas por ADR já existente; reverter se o PI discordar):

- **Fonte dos membros/papel** → **derivado do GitHub** (decorre de tenant = instalação; adia SSO/SCIM, listado em Fora de escopo).
- **Roteamento do tenant** → **path `/t/:tenant`** (subdomínio conflita com ADR-009 enquanto local).
- **Papéis** → **`owner` / `member` / `viewer`**; só `owner` finaliza (ADR-011); `admin` adiado para a fatia de billing.
