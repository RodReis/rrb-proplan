---
proplan: v1
spec: SPEC-007
fatia: 7
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-007 — Insight semântico: arestas inferidas e fallback de Arquitetura/Design

## Objetivo

Fechar o híbrido do ADR-002: onde a convenção não alcança, a IA completa — sempre rotulada, sempre versionada, sempre com caminho de promoção a documento real.

## Escopo

- **Arestas semânticas do grafo** (módulo `insight`):
  - Job disparado após sync com hash novo (mesmo gatilho do resumo): entrada = lista de docs com path + título + headings + primeiras ~40 linhas; saída JSON estrita = pares `{sourcePath, targetPath, motivo}` para relações **não cobertas por link explícito**.
  - Persistência em `DocLink` com `kind: inferred` + `reason`; regeneração por hash substitui as inferidas anteriores, **exceto** as suprimidas.
  - **Supressão manual**: remover aresta inferida na UI persiste `SuppressedLink { projectId, sourcePath, targetPath }` — a supressão sobrevive a regenerações (senão a IA "ressuscita" a aresta que o PI apagou).
  - Cap de custo: uma chamada por sync (batch), não uma por par de docs.
- **Grafo (web)**: arestas inferidas tracejadas âmbar com tooltip do `motivo`; menu de contexto "Remover relação"; contador "N inferidas" com toggle de visibilidade.
- **Fallback de Arquitetura e Design** (fecha o mapa aba→fonte do CONVENTION.md):
  - Projeto sem `ARCHITECTURE.md`/`DESIGN.md`: job gera visão inferida (markdown) a partir dos docs existentes; persistida em `Insight` (`kind: architecture_fallback | design_fallback`) com `docs_tree_sha`.
  - Aba renderiza o conteúdo com **badge âmbar "inferido por IA"** no header (DESIGN.md) + botão **"Promover a documento"**: abre editor com preview → commit `proplan: promove <ARQUIVO> inferido a documento` (write-back compartilhado da Fatia 5) → re-sync → aba passa a usar a fonte primária.
  - Regenerar com confirmação (mesmo padrão da Visão Geral).

## Fora de escopo

Fallback de TESTING (já coberto por CI parse na Fatia 6) e de DEPLOY (proibido por decisão da CONVENTION.md), embeddings/busca semântica, edição de arestas explícitas (derivadas de texto — edite o doc), sugestão de arestas em tempo real durante escrita.

## Critérios de aceite

- [ ] Sync de repo com docs relacionados sem links explícitos produz arestas tracejadas âmbar com motivo no tooltip; explícitas continuam sólidas.
- [ ] Remover aresta inferida → some; Regenerar/re-sync → **não volta** (supressão persistida, verificável em `SuppressedLink`).
- [ ] Sem mudança de docs, nenhuma nova chamada de IA para arestas (mesmo hash ⇒ mesmo resultado armazenado).
- [ ] Projeto sem ARCHITECTURE.md mostra a aba com conteúdo inferido + badge âmbar; "Promover a documento" commita e, após re-sync, o badge some (fonte primária assumiu).
- [ ] Saída de IA fora do schema JSON → 1 retry; persistindo → aba/grafo mostram erro amigável sem afetar dados explícitos.
- [ ] Toggle "mostrar inferidas" esconde/mostra só as tracejadas.

## Contratos

- Prisma: `DocLink.kind` ganha `inferred` + campo `reason?`; nova `SuppressedLink { id, projectId, sourcePath, targetPath, createdAt }` (única por trinca).
- `Insight.kind` ganha `architecture_fallback` e `design_fallback`.
- `DELETE /projects/:id/graph/edges` (body: source/target) → supressão · `POST /projects/:id/tabs/:tab/promote` (body: conteúdo revisado) → commit.

## Notas técnicas

- Prompt de arestas deve receber também a lista de links explícitos existentes para não duplicá-los.
- Fallbacks usam o provedor padrão de `settings` (ADR-008) e o cap de tokens da SPEC-003 (truncamento por prioridade).
- Promoção usa o write-back compartilhado com SHA base — conflito segue o fluxo padrão (re-sync + 1 retry).

## Perguntas abertas

Nenhuma.
