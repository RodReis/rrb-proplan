> migrado para Issues — ver .proplan/STATUS.md

---
proplan: v1
updated: 2026-07-12
---
# Status

Roadmap em fatias verticais — cada fatia entrega valor usável sozinha. Ordem é dependência real: não iniciar fatia N+1 com N incompleta.

## Backlog

### MVP2 — memória operacional verificável (escopo: `docs/specs/MVP2.md`, rascunho)
- Fatia 9 — Modelo canônico + proveniência por campo + confiança determinística (ADR-012) (prio: alta no MVP2; fundação — sem isso o MCP não tem o que servir; sem spec)
- Fatia 10 — `docs/CONTEXT.md`: captura de asserção humana, "o que não mexer", validade por SHA (ADR-013) (prio: alta no MVP2; sem spec)
- Fatia 11 — MCP Server do ProPlan: contrato de evidência obrigatório + 6 tools (prio: alta no MVP2; substitui a antiga "Fatia 9 — servidor MCP"; sem spec)
- Fatia 12 — Migração do Kanban para Issues como fonte, STATUS.md como projeção gerada (ADR-011) (prio: média no MVP2; **pode ser antecipada para a Fatia 5** — pergunta aberta #1 da MVP2.md; sem spec)
- Fatia 13 — Drift docs × sinal do GitHub + handoff exportável (prio: média no MVP2; sem spec)
- Fatia 14 — Views: portfólio da fábrica primeiro; depois radar de risco, timeline, matriz de prontidão (prio: baixa; consequência das fatias acima; sem spec)

### Não priorizado
- Fatia 8 — Multi-tenant: RBAC, organizações, billing (prio: baixa, só se virar produto; OAuth antecipado pela Fatia 1 — ADR-007; sem spec por decisão — especulação até o PI decidir produtizar)
- Stack detectada via SBOM/dependency graph nas abas Arquitetura e Deploy (prio: baixa; autorizado no adendo ao ADR-003, exige spec própria; ressalva: dependency graph desabilitado por padrão em repo privado)
- Defasagem por documento (badge por aba) — só se o alerta global do ADR-010 se provar útil (prio: baixa)
- Observabilidade: métricas de sync/jobs, alertas de rate limit (prio: baixa)

## A Fazer
- Fatia 5 — Kanban sobre **GitHub Issues** (ADR-011): coluna por label, 5 colunas (Descartado visível), projeção em `.proplan/STATUS.md`, escopo OAuth de escrita, importação manual do STATUS.md legado com aviso, migração do bootstrap da Fatia 3, dnd-kit (prio: alta) (spec: SPEC-005 **reescrita, aprovada-pi**)
- Fatia 6 — **Resolução de documentos (ADR-014)** + abas: `DocumentResolver` (convenção → alias → `.proplan/config.yml` → ausente), tela de mapeamento, aba Decisões (arquivo ou coleção `adr/`), Arquitetura, Design, Testes, Deploy, Skills & Agentes; mermaid no viewer (prio: **alta** — sem isso o produto só funciona em repo que segue a convenção) (spec: SPEC-006 ampliada, aprovada-pi)
- Fatia 7 — Insight semântico: nível 3 da escada (classificação semântica), arestas inferidas com supressão manual + fallback IA de Arquitetura/Design com promoção a documento (prio: baixa) (spec: SPEC-007 aprovada-pi)

## Em Andamento
- (vazio)

## Feito
- Definição de arquitetura, ADRs e convenção de dados (em: 2026-07-12)
- Fatia 1 — Fundação: monorepo, docker-compose, login GitHub OAuth (OAuth App), Catalog com listagem de repos + marcar gerenciado (em: 2026-07-12)
- Fatia 2 — Ingestion: sync de docs via Trees/Blobs, hash/diff incremental, no-op idempotente, BullMQ, 4 endpoints, workspace + aba Documentos (react-markdown), 18 testes; aceito runtime pelo PI (em: 2026-07-12)
- Fatia 3 — Insight: resumo IA versionado por hash, bootstrap de STATUS.md com write-back+re-sync, config de provedor (Anthropic/OpenAI/OpenRouter), alerta de defasagem (ADR-010); 42 testes; aceito runtime pelo PI (em: 2026-07-12)
- Fatia 4 — Grafo de links explícitos: extração markdown+wikilinks, resolução relativa, nó fantasma para quebrados, react-flow + d3-force; 56 testes; validado com rrb-adv (119 docs, 105 arestas); aceito runtime pelo PI (em: 2026-07-12)
