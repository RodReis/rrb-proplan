---
proplan: v1
fatia: 7
spec: SPEC-007
status: design-aprovado
updated: 2026-07-13
---
# Design — Fatia 7: Insight semântico

Design de implementação da SPEC-007 (`aprovada-pi`). Fecha o híbrido do ADR-002:
onde a convenção não alcança, a IA completa — sempre rotulada, versionada, com
caminho de promoção a documento real.

> **Fonte de verdade do escopo**: [SPEC-007](../../specs/SPEC-007-insight-semantico.md),
> ADR-002 (IA versionada, nunca no render), ADR-012 (procedência obrigatória),
> ADR-014 (escada, nível 3). O ARCHITECTURE.md já coloca o nível 3 e as arestas
> inferidas no `insight`.

## Decisões do brainstorming (PI, 2026-07-13)

1. **Fronteira insight→ingestion via métodos públicos.** O `insight` gera (IA)
   mas **nunca** escreve nos stores do `ingestion` (`DocLink`, `DocumentResolution`).
   O `IngestionService` expõe `writeInferredEdges`, `suppressEdge`,
   `writeInferredResolution` — dono dos stores, aplica supressão e versionamento.
   Respeita ADR-001.
2. **Gatilho: mesmo listener `DocsSynced`, versionado por hash.** O
   `InsightEventListener` (que já enfileira o resumo) enfileira também os jobs de
   arestas/classificação/fallback. Idempotente por `docsScopeHash` (marcadores
   sentinela no `Insight`). Reusa a infra de IA da Fatia 3.
3. **Nível 3 preenche só os ausentes, depois do rebuild determinístico.** O
   rebuild da Fatia 6 resolve 1/2/4 no fim do sync; o job de IA roda depois e faz
   UPDATE só das linhas `level:4, source:'absent'` (nunca `config`/null-explícito,
   nunca Deploy). Idempotente por hash. Nível 3 **nunca** sobrescreve config/alias.

## Eixos (ordem de entrega — Abordagem A)

A fatia tem 3 eixos independentes, todos sobre a infra de IA do `insight`:
**A) arestas semânticas** (mais isolado, o grafo já existe → primeiro),
**B) nível 3 da escada**, **C) fallback Arquitetura/Design**.

## 1. Prisma + fronteira

Migration `fatia_7_insight_semantico`:

```prisma
enum DocLinkKind { explicit; inferred }        // + inferred
model DocLink { /* … */ reason String? }        // + reason (só em inferred)

model SuppressedLink {
  id String @id @default(uuid())
  projectId String @map("project_id")
  sourcePath String @map("source_path")
  targetPath String @map("target_path")
  createdAt DateTime @default(now()) @map("created_at")
  project Project @relation(fields:[projectId], references:[id], onDelete: Cascade)
  @@unique([projectId, sourcePath, targetPath])
  @@map("suppressed_links")
}

enum InsightKind {
  summary; status_bootstrap;
  architecture_fallback; design_fallback;      // + fallbacks
  edges_marker; classify_marker;               // sentinelas de idempotência por hash
}
```

`DocumentResolution.source` (String, Fatia 6) aceita `'inference'`; `docsTreeSha`
já existe lá.

### Fronteira (Decisão 1) — métodos públicos no IngestionService

```ts
// ingestion/application/ingestion.service.ts — dono dos stores
writeInferredEdges(projectId, edges: { sourcePath; targetPath; reason }[]): Promise<void>
  // resolve paths→ids; exclui pares em SuppressedLink; replace-all das inferidas
suppressEdge(projectId, sourcePath, targetPath): Promise<void>
  // grava SuppressedLink + remove a aresta inferida correspondente
writeInferredResolution(projectId, entity, path, confidence): Promise<void>
  // UPDATE da linha DocumentResolution p/ level:3, source:'inference'
```

O `insight` entrega o resultado da IA; o `ingestion` persiste. O `insight` nunca
toca `prisma.docLink`/`documentResolution`.

## 2. Eixo A — Job de arestas semânticas

**Gatilho** (Decisão 2): `InsightEventListener` enfileira o job `edges` no
`DocsSynced`, `jobId: ${projectId}_edges_${hash}`. `InsightWorker` roteia por nome.

**`InsightService.generateEdges(projectId)`**:
1. Idempotência: se há `Insight kind:'edges_marker'` do `docsScopeHash` atual, não
   re-chama. (Marcador sentinela — `DocLink` não tem `docsTreeSha`; sentinela no
   `Insight` reusa o padrão de idempotência, sem inchar `DocLink`.)
2. Lê docs (path + título + headings + ~40 primeiras linhas) + **links explícitos
   existentes** (pra IA não duplicá-los — nota técnica da spec).
3. `selectContext` (cap de tokens, reusa).
4. Uma chamada IA (batch), JSON estrito `[{sourcePath, targetPath, motivo}]`. 1
   retry em JSON inválido.
5. `ingestion.writeInferredEdges(projectId, edges)` — resolve paths→ids, exclui
   suprimidas, replace-all das inferidas. Grava o marcador do hash.

**Novo `insight/domain/edges-prompt.ts`**: `EDGES_SYSTEM`, `buildEdgesUser(docs,
explicitLinks)`, `parseEdges(text)` (valida JSON, descarta par que não é doc→doc
válido). Testes de parse.

**Custo**: uma chamada por sync (batch) — cap da spec.

## 3. Eixo A — Grafo web

**API** (no `ingestion`):
- `GET /projects/:id/graph` — edges ganham `kind: 'explicit'|'inferred'` + `reason?`.
  Suprimidas não vêm (o store já as exclui).
- `DELETE /projects/:id/graph/edges` (novo) — body `{ sourcePath, targetPath }` →
  `ingestion.suppressEdge`. 202.

**`lib/api.ts`**: `GraphEdge` + `kind`/`reason`; `suppressEdge(...)`.

**`GraphTab.tsx`** (react-flow + d3-force, Fatia 4):
- Inferidas: **tracejadas âmbar** (`--color-warning`), mais finas; explícitas
  seguem sólidas neutras.
- **Tooltip** no hover da inferida: o `reason`.
- **"Remover relação"** (menu/botão no hover) → `ConfirmDialog` → `suppressEdge`
  → some (otimista) + toast.
- **Chip "N inferidas" + toggle** de visibilidade (esconde só as tracejadas;
  estado local, não persiste).
- Coerente com "IA sempre distinguível" (DESIGN.md/ADR-002). Tracejado estático
  (sem animação em loop — DESIGN.md).

## 4. Eixo B — Nível 3 da escada

**Quando** (Decisão 3): depois do rebuild determinístico. Pega só entidades
`level:4, source:'absent'` (nunca `config`/null-explícito, nunca `deploy`).

**`InsightService.classifyAbsent(projectId)`**:
1. Idempotência por hash (`Insight kind:'classify_marker'`).
2. Entidades ausentes via `ingestion.resolutionOf` (as `absent`, exceto deploy).
3. Docs "livres" (que não resolveram entidade nenhuma). Pra cada ausente, IA:
   algum doc **é** essa entidade pelo conteúdo? JSON `[{entity, path, spans[]}]` —
   `spans` sustentam (ADR-012; sem spans, descarta).
4. `ingestion.writeInferredResolution(projectId, entity, path, confidence)` →
   UPDATE p/ `level:3, source:'inference'`. Spans guardados no `Insight` p/ a UI.

**Leitura**: `resolutionOf` (Fatia 6) já lê a linha; só precisa a UI saber
renderizar `source:'inference'`. Escada efetiva: config > convenção > alias >
**inference (3)** > ausente.

**UI** (abas Arquitetura/Design/Decisões da Fatia 6):
- Badge **âmbar "inferido por IA"** (distinto do "reconhecido por nome" cinza).
- **Spans citados** (por quê).
- **"não é isso — corrigir"** → tela de mapeamento (Fatia 6) → `.proplan/config.yml`
  → config vence a IA no próximo sync.

**Coexistência**: rebuild do próximo sync reseta p/ nível 4; IA reclassifica —
idempotente por hash. Nunca sobrescreve config/alias.

## 5. Eixo C — Fallback Arquitetura/Design

Só `architecture` e `design` (Testes = CI parse; Deploy = proibido). Se ausente
(sem doc primário e sem nível 3):

**`InsightService.generateFallback(projectId, entity)`**:
1. Idempotência por hash (`Insight kind: architecture_fallback|design_fallback`).
2. `selectContext` dos docs existentes (cap, reusa).
3. IA gera visão markdown da arquitetura/design inferida. 1 retry.
4. Persiste em `Insight` (versionado por `docsTreeSha`, como o resumo).

**API**:
- `GET /tabs/:tab` (Fatia 6) — entidade ausente **e** há fallback do hash →
  payload `{ markdown, inferred: true }`. Mesmo padrão do fallback CI de Testes.
- `POST /projects/:id/tabs/:tab/promote` (novo) — body `{ content }` (markdown
  revisado) → write-back compartilhado (Fatia 5) commita
  `docs/ARCHITECTURE.md`/`DESIGN.md` (`proplan: promove <ARQUIVO> inferido a
  documento`) → re-sync. Installation token. Conflito → re-sync + 1 retry.

**UI** (abas Arquitetura/Design):
- Badge âmbar **"inferido por IA · \<provider>"** no header (como a Visão Geral).
- **"Promover a documento"** → editor com preview (reusa editor da Fatia 3) →
  `promote` → após re-sync, fonte primária assume, badge some.
- **Regenerar** com `ConfirmDialog` (padrão Visão Geral).

**Precedência na aba** (`getTab` decide): primário (1/2) > inference (3) >
fallback (geração) > "não documentado".

## 6. Resiliência, custo, render

- **JSON fora do schema → 1 retry**; persistindo → aba/grafo mostram erro
  amigável **sem tocar dados explícitos** (arestas explícitas e docs primários
  nunca afetados por falha de IA).
- **Idempotência por hash** em todos: mesmo `docsScopeHash` ⇒ zero nova chamada de
  IA. Marcadores `edges_marker`/`classify_marker` + versionamento dos fallbacks.
- **Falha do provedor** → job re-tenta (BullMQ 2×, backoff — infra Fatia 3);
  grafo/abas seguem servindo o que há.
- **ADR-002 (nunca IA no render)**: tudo assíncrono (BullMQ), artefato versionado,
  `getTab`/`graph` servem do banco. Nenhuma IA em request.
- **Custo** (ADR-008 + cap SPEC-003): provedor de `settings`; cap via
  `selectContext`. Por sync com hash novo: até 3 tipos de chamada, cada uma só se
  há trabalho. **Multiplica IA por sync** → a **Fatia 7.5** (ledger de custo,
  `[paralelo]`) existe pra isso; se a conta assustar aqui, antecipar a 7.5.

## Ordem de execução

1. Prisma + fronteira (`writeInferredEdges`/`suppressEdge`/`writeInferredResolution`) + testes.
2. **Eixo A**: `edges-prompt` + `generateEdges` + listener + `writeInferredEdges`
   (supressão) + `GET graph` estendido + `DELETE edges` + grafo web. Valida ponta a ponta.
3. **Eixo B**: `classifyAbsent` + `writeInferredResolution` + `resolutionOf` lê
   nível 3 + UI das abas.
4. **Eixo C**: `generateFallback` + `getTab` com `inferred` + `POST promote` + UI.
5. Critérios de aceite + docs (DEVELOPMENT.md/STATUS.md) + aceite runtime.

## Critérios de aceite

Os da [SPEC-007](../../specs/SPEC-007-insight-semantico.md#critérios-de-aceite):
arestas tracejadas com motivo · supressão persiste (não volta) · mesmo hash ⇒
zero IA · fallback com badge + promover faz badge sumir · JSON inválido → 1 retry
sem afetar dados explícitos · toggle esconde só inferidas.

## Fora de escopo

Fallback de Testing (CI parse, Fatia 6) e Deploy (proibido). Embeddings/busca
semântica. Edição de arestas explícitas. Sugestão em tempo real. Ledger de custo
(Fatia 7.5).

## Riscos e mitigações

- **IA duplicando link explícito** → o prompt recebe os explícitos; `parseEdges`
  descarta pares já existentes; teste explícito.
- **IA ressuscitando aresta suprimida** → `writeInferredEdges` exclui pares de
  `SuppressedLink` antes de gravar; critério de aceite verifica.
- **Nível 3 sobrescrevendo decisão humana** → só toca `source:'absent'`; config/
  null-explícito/alias intocados; Deploy nunca classificado.
- **Custo de IA multiplicado** → cap por sync + idempotência por hash; gatilho
  documentado pra antecipar a Fatia 7.5.
- **Falha de IA contaminando o grafo** → dados explícitos nunca tocados por falha;
  erro amigável, job re-tenta.
