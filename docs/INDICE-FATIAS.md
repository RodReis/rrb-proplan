# Índice Fatia ↔ SPEC (de-para canônico)

> **Fonte única do pareamento.** Toda outra menção no repo deriva daqui. Extraído do frontmatter (`fatia:`/`spec:`) de cada `docs/specs/SPEC-*.md` — a autoridade. Verificado em 2026-07-15.
>
> **Por que dois números** — `Fatia N` é unidade de trabalho (pode ser fatiada em 7.5/7.6/7.7 depois); `SPEC-NNN` é ID de documento, imutável e em ordem de criação. Eles **divergem de propósito** e não devem ser reconciliados.
>
> ⚠️ **Colisões vivas** — os dígitos batem entre esquemas: **Fatia 9≠SPEC-014 mas Fatia 14=SPEC-019** · **Fatia 10 vs Fatia 15=SPEC-020** · **Fatia 11=SPEC-016 vs Fatia 16=SPEC-021**. **Nunca cite o número nu ("11"): sempre o par — "Fatia 11 (SPEC-016)".**
>
> **Estado não mora aqui.** Coluna do card = GitHub Issues (`.proplan/STATUS.md`). Progresso dentro da fatia = `docs/DEVELOPMENT.md`. Status da spec = frontmatter do arquivo. Esta tabela é só identidade (ADR-011: nenhum fato de estado em dois lugares).

> **Por que este arquivo existe** (decisão do PI, 2026-07-29). A tabela morava numa seção do `docs/STATUS.md`, e a divisão de escrita era *por seção dentro do mesmo arquivo*: o Cowork tocava só o Índice, o Code todo o resto. Isso quebrou por um motivo mecânico, não de disciplina — o `STATUS.md` passou de **170 KB**, e o caminho de publicação do Cowork (API de Contents do GitHub) só substitui arquivo inteiro, nunca uma linha. Extraindo, a divisão passa a ser **arquivo por dono**: este é do Cowork, o `STATUS.md` é do Code, e a superfície de colisão vai a zero.

| Fatia | SPEC | arquivo | o que entrega |
|---|---|---|---|
| 1 | SPEC-001 | `SPEC-001-fundacao.md` | Fundação (monorepo, API, web, DB) |
| 2 | SPEC-002 | `SPEC-002-ingestion.md` | Ingestion de docs via GitHub API |
| 3 | SPEC-003 | `SPEC-003-insight-bootstrap.md` | Insight: resumo, bootstrap, config de IA, alerta de defasagem |
| 4 | SPEC-004 | `SPEC-004-grafo.md` | Grafo de links explícitos |
| 4.5 | SPEC-008 | `SPEC-008-github-app.md` | Migração para GitHub App |
| 5 | SPEC-005 | `SPEC-005-kanban.md` | Kanban sobre GitHub Issues |
| 6 | SPEC-006 | `SPEC-006-abas-convencao.md` | Resolução de documentos + abas |
| 6.1 | SPEC-012 | `SPEC-012-deploy-documento-primeiro.md` | Aba Deploy: documento primeiro |
| 6.2 | SPEC-017 | `SPEC-017-deploy-tres-eixos.md` | Formato de Deploy: 3 eixos |
| 7 | SPEC-007 | `SPEC-007-insight-semantico.md` | Insight semântico |
| 7.5 | SPEC-009 | `SPEC-009-consumo-ia.md` | Consumo de IA: tokens, custo, teto |
| 7.6 | SPEC-010 | `SPEC-010-atividade.md` | Operação assíncrona + painel de Atividade |
| 7.7 | SPEC-011 | `SPEC-011-invalidacao-granular.md` | Invalidação de inferência por `inputHash` |
| 8 | SPEC-022 | `SPEC-022-multi-tenant.md` | Multi-tenant: orgs, RBAC, isolamento por RLS (spec `aprovada-pi` 2026-07-17) |
| 9 | SPEC-014 | `SPEC-014-modelo-canonico.md` | Modelo canônico + proveniência + confiança |
| 10 | SPEC-015 | `SPEC-015-contexto-assercao.md` | `docs/CONTEXT.md` + captura de asserção humana |
| 11 | SPEC-016 | `SPEC-016-mcp-server.md` | MCP Server: contrato de evidência + 6 tools |
| 12 | — | (sem spec) | ~~GitHub Projects v2, sub-issues, issue types~~ — **card descartado** (#4, 2026-07-25): título entregue na Fatia 5, sub-issues na Fatia 18 (SPEC-024); o resto segue como condição no `MVP2.md`, sem card |
| 13 | SPEC-013 | `SPEC-013-drift-deploy.md` | Drift de deploy: confronto de fontes |
| 13.5 | SPEC-018 | `SPEC-018-handoff-exportavel.md` | Handoff exportável |
| 13.6 | SPEC-013.6 | `SPEC-013-6-probe-http.md` | Probe HTTP de URL declarada |
| 14 | SPEC-019 | `SPEC-019-portfolio-radar.md` | Portfólio da fábrica + Radar de risco |
| 15 | SPEC-020 | `SPEC-020-shell-workspace.md` | Shell workspace |
| 16 | SPEC-021 | `SPEC-021-login-catalogo.md` | Login + catálogo |
| 17 | SPEC-023 | `SPEC-023-stack-sbom.md` | Stack detectada via SBOM + confronto doc×real (issue #8; spec `aprovada-pi` 2026-07-17) |
| 18 | SPEC-024 | `SPEC-024-epicos-hierarquia.md` | Épicos: hierarquia MVP→fatia no board via GitHub sub-issues (MVP2; spec `aprovada-pi` 2026-07-20) |
| Deploy | SPEC-027 | `SPEC-027-deploy-railway.md` | Deploy em produção: Railway (compute+banco+fila) + Hostinger (DNS) — pós-MVP, sem número de fatia; issue #103 (spec `aprovada-pi` 2026-07-21) |
| URLs legíveis | SPEC-028 | `SPEC-028-urls-legiveis.md` | URLs legíveis: slug de tenant/projeto em vez de UUID (refina SPEC-022 §4) — pós-MVP, sem número de fatia; issue #107 (spec `aprovada-pi` 2026-07-22) |
| Identidade | SPEC-026 | `SPEC-026-costura-identidade-conexao.md` | Costura identidade ⊥ conexão: Google como 1º IdP, GitHub vira conexão — pós-MVP1, sem número de fatia; issue #94 (spec `aprovada-pi` 2026-07-20) |
| Identidade | SPEC-025 | `SPEC-025-desconectar-reconectar-github-app.md` | Configurações: desconectar / reconectar o GitHub — pós-MVP1, sem número de fatia; issue #93 (spec `aprovada-pi` 2026-07-20). 2ª da Frente Identidade, depois da SPEC-026 |
| 19 | SPEC-029 | `SPEC-029-clientes-funil-link.md` | Clientes + funil Kanban + ciclo de vida do link público — 1ª fatia do MVP3 (`docs/specs/MVP3.md`; spec `aprovada-pi` 2026-07-25) |
| Board (UX) | SPEC-030 | `SPEC-030-painel-detalhe-card.md` | Painel de detalhe do card: corpo da issue, metadados e trilha de eventos — refina a SPEC-005; pós-MVP1, sem número de fatia; issue #128 (spec `aprovada-pi` 2026-07-25). **Entregue 2026-07-26, aguardando aceite** |
| 20 | SPEC-031 | `SPEC-031-briefing-publico.md` | Briefing público: 9 etapas, rascunho retomável, anexos, `BriefingVersion` imutável — 2ª fatia do MVP3; issue #138 (spec `aprovada-pi` 2026-07-26) |
| 21 | SPEC-032 | `SPEC-032-pipeline-ia-artefatos.md` | Pipeline de IA: 4 artefatos versionados + revisor, aprovação humana, edição com autoria — 3ª fatia do MVP3; issue #147 (spec `aprovada-pi` 2026-07-27). **Bloqueada por 2 ADRs** (§4): emenda do teto por tenant → extração do módulo `llm` |
| 22 | SPEC-033 | `SPEC-033-estimativa.md` | Estimativa: decomposição por IA + cálculo determinístico (3 cenários, contingência, custos diretos e de IA, MVPs) — 4ª fatia do MVP3; issue #148 (spec `aprovada-pi` 2026-07-28). **Emenda de 2026-07-28**: sai a duração em dias — os cenários entregam horas e dinheiro, e o divisor de horas produtivas/dia não é implementado em fatia nenhuma (§3) |
| 23 | SPEC-034 | `SPEC-034-contratos.md` | Contratos: perfil do prestador, templates versionados, snapshot imutável e link público de leitura — 5ª fatia do MVP3; issue #149 (spec `aprovada-pi` 2026-07-28) |
| 24 | SPEC-035 | `SPEC-035-dashboard-funil.md` | Dashboard: tela de retomada — o que andou por aqui, esperando você, funil de clientes e Kanban de repos, sem número cruzando os dois domínios (ADR-023) — 6ª e última fatia do MVP3; issue #150 (spec `aprovada-pi` 2026-07-28). **Carimbada com a `Contract` ainda inexistente em código** — ver §4.3 |
| 25 | SPEC-036 | `SPEC-036-licensing-emissao-ativacao.md` | Licensing: schema+RLS, emissão manual no admin (tela mínima), `POST /activate`, license file assinado (Ed25519) — 1ª fatia do MVP4 (`docs/specs/MVP4.md`, frente Licenciamento; piloto War Room); issue #183 (spec `aprovada-pi` 2026-07-29) |
| 26 | SPEC-037 | `SPEC-037-licensing-heartbeat-troca-maquina.md` | Licensing: `heartbeat` (reassina o license file), `deactivate` por fingerprint ou activationId, troca de máquina self-service, contador de trocas como sinal — 2ª fatia do MVP4; issue #188 (spec `aprovada-pi` 2026-07-29) |
| 27 | SPEC-038 | `SPEC-038-licensing-mail-webhook-kiwify.md` | Licensing: módulo `mail` (Resend + BullMQ), webhook da Kiwify por tenant com recebimento idempotente, e ciclo da assinatura (renovação, reembolso, chargeback, inadimplência com tolerância configurável) — 3ª fatia do MVP4; issue #191 (spec `aprovada-pi` 2026-07-29) |
| 28 | SPEC-039 | `SPEC-039-licensing-convite-source-github.md` | Licensing: convite ao repo source no 8º dia (PAT fine-grained por tenant), coleta do username por link de uso único com confirmação por avatar, e revogação que distingue convite pendente de colaborador aceito — 4ª fatia do MVP4; issue #195 (spec `aprovada-pi` 2026-07-29) |
| 29 | SPEC-040 | `SPEC-040-licensing-painel-metricas.md` | Licensing: área própria do tenant (absorve as telas mínimas das fatias 25–28), busca e detalhe que respondem "o que aconteceu com este cliente", estender com carimbo, métricas em contagem — **sem receita, por não haver origem provável** — e exclusão a pedido que anonimiza sem destruir a trilha — 5ª e última fatia do MVP4; issue #196 (spec `aprovada-pi` 2026-07-29) |
| 30 | SPEC-041 | `SPEC-041-licensing-releases-autorizadas.md` | Licensing: releases autorizadas por licença — `LicRelease`, registro manual no admin, `releases/check` e `releases/download` devolvendo URL assinada do GitHub (nenhum byte pela API), autorização por `updatesUntil >= releasedAt` — 6ª fatia do MVP4, pré-requisito do `war-room update` no piloto; issue #203 (spec `aprovada-pi` 2026-07-29). **Bloqueada por ADR novo** (§Notas técnicas): artefato fora do Postgres (gatilho do ADR-025) + exceção estreita ao ADR-015 para ler asset privado com installation token |
