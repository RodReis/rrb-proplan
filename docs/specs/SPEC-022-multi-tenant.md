---
proplan: v1
spec: SPEC-022
fatia: 8
status: rascunho # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-17
---
# SPEC-022 — Multi-tenant: organizações, RBAC e isolamento (Fatia 8)

> **Rascunho.** Fecha o "sem escopo" da Fatia 8 (issue #7). **Não implementar** enquanto houver item em *Perguntas abertas* — são decisões de produto do PI, não de engenharia. Esta spec delimita o território e força as escolhas; não as toma.

## Objetivo

Transformar o ProPlan de usuário único (MVP) em multi-tenant: mais de uma pessoa opera o painel, projetos pertencem a um **tenant** (não a um indivíduo), e o acesso a cada projeto é mediado por papéis. Habilita comercialização (motivo já registrado no ADR-015).

## Contexto herdado (não é decisão nova — já está nos ADRs)

- **ADR-015** já preparou o terreno: GitHub App com **rate limit por instalação** ("escala para multi-tenant sem mudança"), identidade `proplan[bot]` para escritas, Catálogo listando "repos onde o App está instalado". A **instalação do App** já é uma fronteira natural de tenancy.
- **ADR-006/007**: o módulo `identity` nasceu mínimo (login/logout/me); "RBAC e multi-tenant continuam na Fatia 8". Este é o momento.
- **ADR-001**: se multi-tenant exigir streaming/fan-out real, o ADR-004 (BullMQ, sem Kafka) **deve ser revisado**. Provável que não exija no primeiro corte — registrar se exigir.
- **ADR-016**: o teto de gasto de IA é hoje global; passa a ser **por tenant**.

## Escopo (primeiro corte — sujeito às Perguntas abertas)

1. **Modelo de tenant**: entidade `tenant` (ou `organization`) como dona de projetos, membros e teto de IA. Todo dado de projeto passa a ter `tenant_id`.
2. **Membros e papéis (RBAC)**: um usuário pertence a um ou mais tenants com um papel. Papel decide quem pode: gerenciar/remover projeto, mover cards e escrever no board, aceitar/finalizar (o ato do dono, ADR-011), ver o painel de custo de IA, administrar membros e billing.
3. **Isolamento de dados**: toda query passa a ser escopada por `tenant_id`; nenhuma rota serve dado de tenant a que o usuário logado não pertence. Leitura do GitHub continua com **user-to-server token** (ADR-015) — a visibilidade real do GitHub é a segunda barreira.
4. **Migração do usuário único**: os dados atuais viram o **tenant pessoal** do dono, sem perda.
5. **Teto de IA por tenant**: o ledger e o teto do ADR-016 passam a ser escopados por tenant.

## Fora de escopo (deste corte)

- **Billing/cobrança real** (Stripe, assentos, planos) — ver Pergunta aberta 6; provável **fatia própria** depois.
- Mudança no fluxo de auth do GitHub App (ADR-015 permanece) — só passa a existir múltiplos tenants sobre ele.
- SSO corporativo, SCIM, convites por e-mail fora do GitHub — só se a fonte de membros deixar de ser o GitHub (Pergunta aberta 3).
- Webhooks (ADR-009 mantém: sem webhooks enquanto local).

## Critérios de aceite (a completar após as Perguntas abertas)

- [ ] Dois usuários distintos, em tenants distintos, não enxergam os projetos um do outro por nenhuma rota (verificado com token de cada um).
- [ ] Um usuário `viewer` não consegue mover card nem finalizar issue; a UI esconde e a API recusa (defesa em profundidade — não confiar só no front).
- [ ] O ato de **aceitar/finalizar** (ADR-011) só é permitido ao papel definido como dono; nenhuma automação forja aceite mesmo com multi-tenant.
- [ ] Os dados do usuário único atual aparecem intactos dentro do seu tenant pessoal após a migração.
- [ ] O teto de gasto de IA é aplicado e exibido por tenant; estourar o teto de um tenant não afeta outro.
- [ ] Nenhuma query de projeto/board/insight sem cláusula de `tenant_id` (verificável por auditoria de código ou teste).

## Contratos (esboço — assinaturas, não implementação)

- Modelo: `Tenant`, `Membership { userId, tenantId, role }`. `Project`, `Issue`(cache), `AiLedger`, `Insight` ganham `tenantId`.
- Rotas passam a resolver o tenant ativo (por header, subdomínio ou seleção de sessão — Pergunta aberta 4) e a exigir papel mínimo por operação.
- `identity`: expõe `currentMembership()` / guard de papel para os outros módulos (interface pública, sem vazar entidade — ADR-001).

## Notas técnicas

- **Isolamento**: coluna `tenant_id` + escopo na aplicação é o caminho mais simples; Postgres RLS (Supabase) é a alternativa mais forte porém mais cara. Decisão na Pergunta aberta 2.
- **RBAC**: derivar papel das permissões do GitHub (quem administra a org/repo é admin no ProPlan) evita um segundo sistema de convites, mas acopla o modelo de acesso ao GitHub. Pergunta aberta 3.
- Revisar **ADR-004** só se o primeiro corte exigir fan-out entre tenants (improvável).

## Perguntas abertas

> Todas BLOQUEIAM implementação. São de produto — decisão do PI.

1. **Tenant = instalação do GitHub App, ou entidade própria do ProPlan?** O ADR-015 já agrupa por instalação. Amarrar tenant à instalação é barato e coerente; desacoplar dá flexibilidade (um tenant com várias orgs GitHub) ao custo de um modelo próprio de convite/membro. Qual?
2. **Isolamento: `tenant_id` na aplicação ou RLS no Postgres?** RLS é mais à prova de bug de query esquecida, porém amarra a Supabase e complica migrações/seed. Aceita o custo?
3. **Fonte dos membros e do papel: GitHub ou ProPlan?** Derivar de quem tem acesso ao repo/org (sem convite próprio) vs. sistema de convite/papel próprio do ProPlan. Isso define se SSO/SCIM entram algum dia.
4. **Seleção do tenant ativo**: subdomínio (`acme.proplan…`), seletor na sessão, ou path (`/t/:tenant/…`)? Afeta rotas e cookies.
5. **Papéis mínimos**: bastam `owner` / `member` / `viewer`, ou precisa `admin` separado de `owner` (billing vs. operação)? Quem pode **finalizar** (o ato do dono do ADR-011)?
6. **Billing entra nesta fatia ou vira a próxima?** Se entra: cobra por assento, por repo gerenciado, ou por tenant? Provedor (Stripe)? Se não entra, confirmo que a fatia entrega o isolamento sem cobrança.
7. **Numeração**: mantenho `fatia: 8` (histórica) e registro SPEC-022 no de-para do `docs/STATUS.md`. Confirma?
