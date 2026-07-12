---
proplan: v1
spec: SPEC-004
fatia: 4
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-004 — Grafo de relacionamento dos documentos (links explícitos)

## Objetivo

Ver a documentação do projeto como um mapa: quais documentos existem, como se referenciam e onde estão os buracos — a visão "tipo mapa mental" que motivou o produto.

## Escopo

- **Extração de links (módulo `ingestion`, novo passo do pipeline de sync)**:
  - Fontes: links markdown relativos (`[x](ARCHITECTURE.md)`, `[y](./specs/SPEC-001.md#secao)`) e wikilinks (`[[ARCHITECTURE]]`).
  - Resolução: relativa à pasta do arquivo de origem; normalização de caminho; âncoras (`#...`) descartadas na resolução, preservadas como metadado.
  - Persistência: `doc_links (sourceDocumentId, targetDocumentId?, targetPath, kind: explicit, anchor?)`. Alvo fora do escopo ingerido ou inexistente → `targetDocumentId` nulo (**link quebrado**).
  - Extração roda no mesmo job de sync, após persistência dos documentos; re-executa junto do sync (mesma idempotência por hash).
- **API (`ingestion`)**: `GET /projects/:id/graph` → `{ nodes: [{docId, path, isConventional, kind: readme|claude|doc}], edges: [{source, target?, targetPath, broken}] }`.
- **Web — aba Grafo** (ativa):
  - react-flow com **layout de força/orgânico (d3-force)**: docs conectados se aglomeram, isolados ficam à margem; nós = documentos (cor por tipo: README / CLAUDE.md / doc de convenção / doc livre — tokens do DESIGN.md); arestas explícitas sólidas.
  - **Links quebrados**: nó fantasma tracejado na cor `error` exibindo o path faltante; clicar mostra quais documentos o referenciam.
  - **Links externos (http/https): fora do grafo** — somente relações internas entre documentos do escopo ingerido.
  - Interações (DESIGN.md): entrada com stagger, hover destaca vizinhos e esmaece o resto, clique no nó abre o documento em painel lateral (reusa o viewer da Fatia 2), pan/zoom com inércia, minimapa, botão "re-centralizar".
  - Nó sem nenhuma aresta fica visualmente agrupado numa área "sem conexões" (sinal honesto de doc isolada — é exatamente o problema que o produto expõe).

## Fora de escopo

Arestas semânticas inferidas por IA e remoção manual de arestas (Fatia 7), edição de documentos, clustering/agrupamento por pasta, filtros avançados, busca no grafo, links por âncora como arestas distintas.

## Critérios de aceite

- [ ] Sync de um repo com links relativos entre MDs produz o grafo com as arestas corretas (validar com o próprio rrb-proplan: README → docs/*, specs → ADRs).
- [ ] Wikilink `[[NOME]]` resolve para `NOME.md` no escopo (case-insensitive) quando existir.
- [ ] Link para arquivo inexistente aparece como nó fantasma tracejado (cor `error`) com o path faltante; links http/https não geram nós nem arestas.
- [ ] Clique no nó abre o documento no painel lateral sem sair da aba.
- [ ] Hover destaca vizinhos diretos e esmaece o resto (150ms).
- [ ] Repo com 200+ documentos continua navegável (pan/zoom fluidos — animar só transform/opacity).
- [ ] Re-sync após editar links atualiza o grafo (arestas antigas removidas).

## Contratos

- Prisma novo: `DocLink { id, projectId, sourceDocumentId, targetDocumentId?, targetPath, kind, anchor? }` (índice por projectId; recriados a cada sync do documento fonte).
- `ingestion` continua dono da extração — grafo é dado derivado da documentação, não conteúdo novo (nenhuma IA nesta fatia).

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-12: layout força/orgânico ✔ · quebrados como nó fantasma vermelho ✔ · externos fora do grafo ✔
