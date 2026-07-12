---
proplan: v1
updated: 2026-07-12
---
# Status

Roadmap em fatias verticais — cada fatia entrega valor usável sozinha. Ordem é dependência real: não iniciar fatia N+1 com N incompleta.

## Backlog
- Fatia 8 — Multi-tenant: RBAC, organizações, billing (prio: baixa, só se virar produto; OAuth antecipado pela Fatia 1 — ADR-007; sem spec por decisão — especulação até o PI decidir produtizar)
- Observabilidade: métricas de sync/jobs, alertas de rate limit (prio: baixa)

## A Fazer
- Fatia 3 — Insight: resumo de estado, bootstrap de STATUS.md e configuração de provedor de IA (prio: alta) (spec: SPEC-003 aprovada-pi)
- Fatia 4 — Grafo de links explícitos com react-flow + d3-force (prio: média) (spec: SPEC-004 aprovada-pi)
- Fatia 5 — Kanban: CRUD de cards sobre STATUS.md, dnd-kit, write-back via commit + re-sync (ADR-009: sem webhook no MVP) (prio: alta) (spec: SPEC-005 aprovada-pi)
- Fatia 6 — Abas Arquitetura, Design, Testes, Deploy e Skills & Agentes: render das fontes primárias, mermaid no viewer, parse de .claude/ e workflows (prio: média) (spec: SPEC-006 aprovada-pi)
- Fatia 7 — Insight semântico: arestas inferidas com supressão manual + fallback IA de Arquitetura/Design com promoção a documento (prio: baixa) (spec: SPEC-007 aprovada-pi)

## Em Andamento
- (vazio)

## Feito
- Definição de arquitetura, ADRs e convenção de dados (em: 2026-07-12)
- Fatia 1 — Fundação: monorepo, docker-compose, login GitHub OAuth (OAuth App), Catalog com listagem de repos + marcar gerenciado (em: 2026-07-12)
- Fatia 2 — Ingestion: sync de docs via Trees/Blobs, hash/diff incremental, no-op idempotente, BullMQ, 4 endpoints, workspace + aba Documentos (react-markdown), 18 testes; aceito runtime pelo PI (em: 2026-07-12)
