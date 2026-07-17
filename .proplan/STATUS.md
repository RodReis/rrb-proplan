---
proplan: v1
updated: 2026-07-17
---
<!-- gerado pelo ProPlan a partir das Issues — não edite à mão -->
# Status

## Backlog

- Observabilidade: métricas de sync/jobs, alertas de rate limit (#10, prio: media)
- Defasagem por documento (badge por aba) — só se o alerta global do ADR-010 se provar útil (#9, prio: baixa)
- Fatia 12 — Migração do Kanban para Issues como fonte, STATUS.md como projeção gerada (ADR-011) (#4)

## A Fazer

- Stack detectada via SBOM/dependency graph nas abas Arquitetura e Deploy (#8, prio: baixa)
- Fatia 8 — Multi-tenant: RBAC, organizações, billing (#7, prio: baixa)

## Em Andamento

- Definição de arquitetura, ADRs e convenção de dados (#13)

## Feito

_(vazio)_

## Finalizado

- Correção — a guarda anti-drift não guardava: nem o histórico do TESTS.md, nem a si mesma (#74, prio: alta, finalizado em: 2026-07-17)
- Correção — TESTS.md sobrescreve o histórico em vez de acumular (append-only quebrado) (#72, prio: alta, finalizado em: 2026-07-16)
- Fatia 11 — MCP Server do ProPlan: contrato de evidência obrigatório + 6 tools (#3, prio: alta, finalizado em: 2026-07-16)
- Fatia 9 — Modelo canônico + proveniência por campo + confiança determinística (SPEC-014) (#1, prio: alta, finalizado em: 2026-07-15)
- Fatia 13.6 — Probe HTTP de URL declarada: o confronto com o mundo (SPEC-013.6) (#42, prio: alta, finalizado em: 2026-07-15)
- Fatia 13 — Drift de deploy: confronto de fontes, sem coroar verdade (SPEC-013 v2.1) (#5, prio: alta, finalizado em: 2026-07-15)
- Fatia 7.7 — Invalidação de inferência por inputHash (SPEC-011) (#31, prio: alta, finalizado em: 2026-07-14)
- Atividade — gaveta fecha sozinha 4s após abrir pelo sync (#80, prio: media, finalizado em: 2026-07-17)
- Correção — --dim reprova contraste AA nos dois temas (#78, prio: media, finalizado em: 2026-07-17)
- Kanban — card mostra data/hora: criação nas colunas abertas, finalização em Finalizado/Descartado (#76, prio: media, finalizado em: 2026-07-17)
- Correção — Kanban só mostra o card na coluna certa depois de um F5 (corrida no sync) (#70, prio: media, finalizado em: 2026-07-16)
- Correção — retry de conflito no write-back reusa conteúdo velho (apaga edição concorrente) (#69, prio: media, finalizado em: 2026-07-16)
- Fatia 15 — Shell workspace + temas Carbono/Claro (#56, prio: media, finalizado em: 2026-07-16)
- Fatia 16 — Telas Login e Catálogo (padrão workspace) (#57, prio: media, finalizado em: 2026-07-16)
- Fatia 6.2 — Formato de Deploy: 3 eixos (ambiente × componente × infra de apoio) (#53, prio: media, finalizado em: 2026-07-15)
- Fatia 6.1 — Aba Deploy: documento primeiro, painel de ambientes como enriquecimento (SPEC-012) (#38, prio: media, finalizado em: 2026-07-15)
- Correção — tela de Mapeamento exibe coleção como "ausente" (#36, prio: media, finalizado em: 2026-07-15)
- Fatia 14 — Views: portfólio da fábrica primeiro; depois radar de risco, timeline, matriz de prontidão (#6, prio: baixa, finalizado em: 2026-07-15)
- Fatia 7 — Insight semântico: nível 3 da escada (classificação semântica), arestas inferidas com supressão manual + fallback IA de Arquitetura/Design com promoção a documento (#12, prio: baixa, finalizado em: 2026-07-13)
- Fatia 6 — Resolução de documentos (ADR-014) + abas: DocumentResolver (convenção → alias → .proplan/config.yml → ausente), tela de mapeamento, aba Decisões (arquivo ou coleção adr/), Arquitetura, Design, Testes, Deploy, Skills & Agentes; mermaid no viewer (#11, prio: baixa, finalizado em: 2026-07-13)
- CI: relatório de testes gerado + evidência por SPEC/issue (ADR-019) (#60, finalizado em: 2026-07-16)
- Fatia 13.5 — Handoff exportável (#51, finalizado em: 2026-07-15)
- Fatia 10 — docs/CONTEXT.md + captura de asserção humana (SPEC-015) (#46, finalizado em: 2026-07-15)
- Fatia 7.6 — Operação assíncrona visível + painel de Atividade (#19, finalizado em: 2026-07-14)
- Fatia 7.5 — Consumo de IA: ledger, custo e teto de gasto (#25, finalizado em: 2026-07-14)

## Descartado

- Fatia 10 — docs/CONTEXT.md: captura de asserção humana, "o que não mexer", validade por SHA (ADR-013) (#2, prio: alta, descartado em: 2026-07-17)
