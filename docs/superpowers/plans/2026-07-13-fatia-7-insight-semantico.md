# Fatia 7 — Insight semântico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onde a convenção não alcança, a IA completa — arestas semânticas no grafo, classificação de documento ausente (nível 3), e fallback de Arquitetura/Design — sempre rotulado, versionado por hash, com caminho de promoção a documento real.

**Architecture:** O `insight` gera (IA, assíncrono via BullMQ) mas nunca escreve nos stores do `ingestion`; entrega o resultado por métodos públicos do `IngestionService` (`writeInferredEdges`/`suppressEdge`/`writeInferredResolution`), que é dono da persistência (supressão, versionamento). Gatilho no mesmo listener `DocsSynced` da Fatia 3, idempotente por `docsScopeHash`. Nenhuma IA no caminho de render (ADR-002).

**Tech Stack:** NestJS + TypeScript (jest) · Prisma/PostgreSQL · BullMQ/Redis · React + Vite (react-flow, d3-force) · LLM via `insight` (Anthropic/OpenAI-compat, ADR-008).

## Global Constraints

- **Idioma**: docs/specs/commits/comunicação em pt-BR; código e identificadores em inglês. (CLAUDE.md)
- **Nunca IA no render** (ADR-002): jobs assíncronos, artefato versionado por `docsTreeSha`; `getTab`/`graph` servem do banco.
- **Fronteira de módulo** (ADR-001): `insight` nunca toca `prisma.docLink`/`documentResolution` — só chama métodos públicos do `IngestionService`.
- **Procedência obrigatória** (ADR-012): classificação nível 3 exige spans citados; sem spans, descarta.
- **Nível 3 nunca sobrescreve decisão humana**: só toca linhas `level:4, source:'absent'`. Config/null-explícito/alias intocados. **Deploy nunca é classificado** (CONVENTION.md).
- **Supressão persiste**: aresta inferida removida vai pra `SuppressedLink`; regeneração nunca a ressuscita.
- **Idempotência por hash**: mesmo `docsScopeHash` ⇒ zero nova chamada de IA (marcadores sentinela no `Insight`).
- **Falha de IA nunca afeta dados explícitos**: JSON inválido → 1 retry; persistindo → erro amigável, arestas explícitas e docs primários intocados.
- **Escrita = installation token** (bot, ADR-015); leitura = user token.
- **Estrutura por módulo**: `presentation/`·`application/`·`domain/`·`infrastructure/`. Testes junto (`*.spec.ts`).
- **PI edita docs em paralelo** — `git add` sempre por arquivo, nunca `-A`/`docs/`.
- **Portas**: web 5180, API 3311, Postgres 5433, Redis 6380. API lê `apps/api/.env`.
- **Commits**: pt-BR, imperativo, prefixo do módulo.

---

## Estrutura de arquivos

**Prisma**: `schema.prisma` (DocLink `inferred`+`reason`; `SuppressedLink`; `InsightKind` +4) + migration `fatia_7_insight_semantico`.

**`ingestion` (dono dos stores)**:
- `application/ingestion.service.ts` (modificar) — `writeInferredEdges`, `suppressEdge`, `writeInferredResolution`; `graph()` estende edges com `kind`/`reason`.
- `application/inferred-links.service.ts` (novo, opcional) — lógica de replace-all das inferidas com exclusão de suprimidas (extraída se o service crescer).
- `presentation/ingestion.controller.ts` (modificar) — `DELETE /graph/edges`.

**`insight` (gera IA)**:
- `domain/edges-prompt.ts` (novo) — `EDGES_SYSTEM`, `buildEdgesUser`, `parseEdges`.
- `domain/classify-prompt.ts` (novo) — `CLASSIFY_SYSTEM`, `buildClassifyUser`, `parseClassify`.
- `domain/fallback-prompt.ts` (novo) — `FALLBACK_SYSTEM`, `buildFallbackUser` (markdown, sem parse estrito).
- `application/insight.service.ts` (modificar) — `generateEdges`, `classifyAbsent`, `generateFallback`, `latestFallback`, `promote`.
- `infrastructure/insight.worker.ts` (modificar) — listener enfileira `edges`/`classify`/`fallback`; worker roteia por nome.

**`board`** (dono do `getTab`):
- `application/tabs.service.ts` (modificar) — payload com `inferred:true` quando há fallback; consome `insight.latestFallback`.
- `presentation/tabs.controller.ts` (modificar) — `POST /tabs/:tab/promote`.

**Front**:
- `lib/api.ts` — `GraphEdge`+`kind`/`reason`; `suppressEdge`; tab payload `inferred`; `promote`.
- `pages/workspace/GraphTab.tsx` — inferidas tracejadas âmbar, tooltip, remover, toggle.
- `pages/workspace/tabs/ArchitectureTab.tsx`/`DesignTab.tsx` — badge âmbar + fallback + promover + regenerar; badge nível 3 + spans + corrigir.

---

## FASE 0 — Prisma + fronteira

### Task 1: Prisma — inferred, SuppressedLink, InsightKind

**Files:** Modify `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Editar o schema**

`enum DocLinkKind` já existe com `explicit` (Fatia 4) — adicionar `inferred`. Em `model DocLink`, adicionar `reason String?`. Em `enum InsightKind` (Fatia 3) — adicionar `architecture_fallback`, `design_fallback`, `edges_marker`, `classify_marker`. Adicionar o model:

```prisma
model SuppressedLink {
  id         String   @id @default(uuid())
  projectId  String   @map("project_id")
  sourcePath String   @map("source_path")
  targetPath String   @map("target_path")
  createdAt  DateTime @default(now()) @map("created_at")
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([projectId, sourcePath, targetPath])
  @@map("suppressed_links")
}
```

E a relação `suppressedLinks SuppressedLink[]` em `model Project`.

- [ ] **Step 2: Migration**

Run: `cd apps/api && npx prisma migrate dev --name fatia_7_insight_semantico`
Expected: cria+aplica+regenera. Se pedir reset → BLOCKED (há dados). Se EPERM no generate (processos nest órfãos) → o controller mata os processos.

- [ ] **Step 3:** `cd apps/api && npx tsc --noEmit` → sem erro.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "insight: Prisma — DocLink.inferred+reason, SuppressedLink, InsightKind fallbacks/markers (migration)"
```

---

### Task 2: Fronteira — writeInferredEdges + suppressEdge no IngestionService

**Files:**
- Modify: `apps/api/src/modules/ingestion/application/ingestion.service.ts`
- Test: `apps/api/src/modules/ingestion/application/inferred-links.spec.ts`

**Interfaces:**
- Produces: `IngestionService.writeInferredEdges(projectId, edges: InferredEdgeInput[])`, `IngestionService.suppressEdge(projectId, sourcePath, targetPath)`. `InferredEdgeInput = { sourcePath, targetPath, reason }`.

- [ ] **Step 1: Teste (mock Prisma)**

```ts
// apps/api/src/modules/ingestion/application/inferred-links.spec.ts
import { IngestionService } from './ingestion.service';

function svc(overrides: any = {}) {
  const created: any[] = [];
  const prisma = {
    document: { findMany: jest.fn().mockResolvedValue(overrides.docs ?? []) },
    suppressedLink: {
      findMany: jest.fn().mockResolvedValue(overrides.suppressed ?? []),
      create: jest.fn().mockResolvedValue({}),
    },
    docLink: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockImplementation(({ data }: any) => { created.push(...data); return Promise.resolve({}); }),
    },
    project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
    $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
  };
  // construir com a assinatura real do IngestionService (prisma, queue) — ajustar
  return { svc: new IngestionService(prisma as any, {} as any), prisma, created };
}

describe('IngestionService.writeInferredEdges', () => {
  it('resolve paths→ids, exclui suprimidas, replace-all das inferidas', async () => {
    const { svc, prisma, created } = svc({
      docs: [{ id: 'a', path: 'docs/a.md' }, { id: 'b', path: 'docs/b.md' }, { id: 'c', path: 'docs/c.md' }],
      suppressed: [{ sourcePath: 'docs/a.md', targetPath: 'docs/c.md' }],
    });
    await svc.writeInferredEdges('p1', [
      { sourcePath: 'docs/a.md', targetPath: 'docs/b.md', reason: 'ambos falam de X' },
      { sourcePath: 'docs/a.md', targetPath: 'docs/c.md', reason: 'suprimida — não deve entrar' },
    ]);
    // deleta as inferidas antigas antes de criar
    expect(prisma.docLink.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: 'p1', kind: 'inferred' }) }));
    // só a não-suprimida vira aresta, com kind inferred + reason + ids resolvidos
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ projectId: 'p1', sourceDocumentId: 'a', targetDocumentId: 'b', kind: 'inferred', reason: 'ambos falam de X' });
  });

  it('descarta par cujo source/target não existe como document', async () => {
    const { svc, created } = svc({ docs: [{ id: 'a', path: 'docs/a.md' }] });
    await svc.writeInferredEdges('p1', [{ sourcePath: 'docs/a.md', targetPath: 'docs/naoexiste.md', reason: 'r' }]);
    expect(created).toHaveLength(0);
  });
});

describe('IngestionService.suppressEdge', () => {
  it('grava SuppressedLink e remove a aresta inferida correspondente', async () => {
    const { svc, prisma } = svc();
    await svc.suppressEdge('p1', 'docs/a.md', 'docs/b.md');
    expect(prisma.suppressedLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', sourcePath: 'docs/a.md', targetPath: 'docs/b.md' }) }));
    expect(prisma.docLink.deleteMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** `cd apps/api && npx jest inferred-links` → FAIL.

- [ ] **Step 3: Implementar** (métodos no `IngestionService`)

```ts
export interface InferredEdgeInput { sourcePath: string; targetPath: string; reason: string; }

/**
 * Persiste as arestas inferidas pela IA (ADR-014 nível grafo). O insight ENTREGA
 * os pares; o ingestion — dono do store — resolve paths→ids, exclui os suprimidos
 * (SuppressedLink) e faz replace-all das inferidas do projeto. As explícitas nunca
 * são tocadas. Pares cujo source/target não é um document conhecido são descartados.
 */
async writeInferredEdges(projectId: string, edges: InferredEdgeInput[]): Promise<void> {
  const docs = await this.prisma.document.findMany({ where: { projectId }, select: { id: true, path: true } });
  const idByPath = new Map(docs.map((d) => [d.path, d.id]));
  const suppressed = await this.prisma.suppressedLink.findMany({ where: { projectId }, select: { sourcePath: true, targetPath: true } });
  const suppressedSet = new Set(suppressed.map((s) => `${s.sourcePath} ${s.targetPath}`));

  const rows = edges
    .filter((e) => idByPath.has(e.sourcePath) && idByPath.has(e.targetPath))
    .filter((e) => !suppressedSet.has(`${e.sourcePath} ${e.targetPath}`))
    .map((e) => ({
      projectId,
      sourceDocumentId: idByPath.get(e.sourcePath)!,
      targetDocumentId: idByPath.get(e.targetPath)!,
      targetPath: e.targetPath,
      kind: 'inferred' as const,
      reason: e.reason,
    }));

  await this.prisma.$transaction([
    this.prisma.docLink.deleteMany({ where: { projectId, kind: 'inferred' } }),
    ...(rows.length ? [this.prisma.docLink.createMany({ data: rows })] : []),
  ]);
}

/** Supressão manual de uma aresta inferida (persiste e some — não volta na regeneração). */
async suppressEdge(projectId: string, sourcePath: string, targetPath: string): Promise<void> {
  await this.prisma.suppressedLink.create({
    data: { projectId, sourcePath, targetPath },
  }).catch(() => { /* @@unique — já suprimida, idempotente */ });
  await this.prisma.docLink.deleteMany({
    where: { projectId, kind: 'inferred', targetPath, source: { path: sourcePath } },
  });
}
```

> Ajuste o `where` do `deleteMany` em `suppressEdge` à relação real do `DocLink` (o filtro por `source.path` depende da relação nomeada `source` — confirme no schema; se não houver, resolva o sourceDocumentId por path antes).

- [ ] **Step 4:** `cd apps/api && npx jest inferred-links && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion/application/ingestion.service.ts apps/api/src/modules/ingestion/application/inferred-links.spec.ts
git commit -m "ingestion: writeInferredEdges + suppressEdge (fronteira p/ o insight, ADR-001)"
```

---

## FASE 1 — Eixo A: arestas semânticas

### Task 3: edges-prompt (prompt + parse)

**Files:**
- Create: `apps/api/src/modules/insight/domain/edges-prompt.ts`
- Test: `apps/api/src/modules/insight/domain/edges-prompt.spec.ts`

**Interfaces:**
- Produces: `EDGES_SYSTEM`, `buildEdgesUser(docs, explicitPairs)`, `parseEdges(text): InferredEdge[]` com `InferredEdge = { sourcePath, targetPath, reason }`.

- [ ] **Step 1: Teste**

```ts
// apps/api/src/modules/insight/domain/edges-prompt.spec.ts
import { parseEdges } from './edges-prompt';

describe('parseEdges', () => {
  it('parseia array JSON de {sourcePath,targetPath,motivo}', () => {
    const text = '```json\n[{"sourcePath":"docs/a.md","targetPath":"docs/b.md","motivo":"ambos tratam de X"}]\n```';
    const edges = parseEdges(text);
    expect(edges).toEqual([{ sourcePath: 'docs/a.md', targetPath: 'docs/b.md', reason: 'ambos tratam de X' }]);
  });
  it('descarta itens sem os 3 campos', () => {
    const text = '[{"sourcePath":"a"},{"sourcePath":"docs/a.md","targetPath":"docs/b.md","motivo":"m"}]';
    expect(parseEdges(text)).toHaveLength(1);
  });
  it('descarta self-link (source==target)', () => {
    const text = '[{"sourcePath":"docs/a.md","targetPath":"docs/a.md","motivo":"m"}]';
    expect(parseEdges(text)).toHaveLength(0);
  });
  it('JSON malformado → lança (caller faz retry)', () => {
    expect(() => parseEdges('nao e json')).toThrow();
  });
});
```

- [ ] **Step 2:** `cd apps/api && npx jest edges-prompt` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/insight/domain/edges-prompt.ts
export interface InferredEdge { sourcePath: string; targetPath: string; reason: string; }

export const EDGES_SYSTEM = `Você relaciona documentos de um repositório. Recebe uma lista de documentos (path, título, headings, início do texto) e os links explícitos já existentes entre eles. Sua tarefa: apontar relações SEMÂNTICAS reais NÃO cobertas por link explícito — quando dois documentos claramente tratam do mesmo assunto, um depende do outro, ou um detalha o que o outro menciona.

Regras:
- Só relações que se sustentam pelo conteúdo. Na dúvida, NÃO relacione.
- NÃO repita um par que já é link explícito.
- NÃO relacione um documento a si mesmo.
- Responda SÓ com um array JSON, sem prosa: [{"sourcePath","targetPath","motivo"}]. "motivo" é uma frase curta em pt-BR.`;

export function buildEdgesUser(
  docs: { path: string; title: string; headings: string[]; excerpt: string }[],
  explicitPairs: { source: string; target: string }[],
): string {
  const docList = docs.map((d) => `### ${d.path}\nTítulo: ${d.title}\nHeadings: ${d.headings.join(' · ')}\n${d.excerpt}`).join('\n\n');
  const explicit = explicitPairs.map((p) => `${p.source} → ${p.target}`).join('\n') || '(nenhum)';
  return `Documentos:\n\n${docList}\n\nLinks explícitos já existentes (NÃO repita):\n${explicit}`;
}

export function parseEdges(text: string): InferredEdge[] {
  const arr = extractJsonArray(text);
  return arr
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ sourcePath: x.sourcePath, targetPath: x.targetPath, reason: x.motivo }))
    .filter((e): e is InferredEdge =>
      typeof e.sourcePath === 'string' && typeof e.targetPath === 'string' &&
      typeof e.reason === 'string' && e.sourcePath !== e.targetPath && e.sourcePath !== '' && e.targetPath !== '');
}

function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  if (start === -1) throw new Error('nenhum array JSON');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { return JSON.parse(text.slice(start, i + 1)); } }
  }
  throw new Error('array JSON não fechado');
}
```

- [ ] **Step 4:** `cd apps/api && npx jest edges-prompt` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/insight/domain/edges-prompt.ts apps/api/src/modules/insight/domain/edges-prompt.spec.ts
git commit -m "insight: prompt + parse de arestas semânticas"
```

---

### Task 4: generateEdges + listener + worker

**Files:**
- Modify: `apps/api/src/modules/insight/application/insight.service.ts`
- Modify: `apps/api/src/modules/insight/infrastructure/insight.worker.ts`
- Test: `apps/api/src/modules/insight/application/generate-edges.spec.ts`

**Interfaces:**
- Consumes: `edges-prompt`, `selectContext`, `LlmClientFactory`, `IngestionService.writeInferredEdges` (injetar `IngestionService` no `InsightService`).
- Produces: `InsightService.generateEdges(projectId): Promise<void>`.

- [ ] **Step 1: Teste** (mock: prisma marker check, llm retorna JSON, verifica ingestion.writeInferredEdges chamado)

```ts
// apps/api/src/modules/insight/application/generate-edges.spec.ts
import { InsightService } from './insight.service';

describe('InsightService.generateEdges', () => {
  it('idempotente: marker do hash existe → não chama IA', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue({ id: 'marker' }) },
    } as any;
    const llmFactory = { create: jest.fn() } as any;
    const ingestion = { writeInferredEdges: jest.fn() } as any;
    const settings = { providerOf: jest.fn() } as any;
    const svc = new InsightService(prisma, settings, llmFactory, ingestion);
    await svc.generateEdges('p1');
    expect(llmFactory.create).not.toHaveBeenCalled();
    expect(ingestion.writeInferredEdges).not.toHaveBeenCalled();
  });

  it('gera: chama IA, entrega ao ingestion, grava marker', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      document: { findMany: jest.fn().mockResolvedValue([{ path: 'docs/a.md', content: '# A\nfala de X' }, { path: 'docs/b.md', content: '# B\nfala de X' }]) },
      docLink: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const client = { provider: 'anthropic', complete: jest.fn().mockResolvedValue({ text: '[{"sourcePath":"docs/a.md","targetPath":"docs/b.md","motivo":"X"}]', model: 'm', inputTokens: 10, outputTokens: 5 }) };
    const llmFactory = { create: jest.fn().mockReturnValue(client) } as any;
    const ingestion = { writeInferredEdges: jest.fn().mockResolvedValue(undefined) } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const svc = new InsightService(prisma, settings, llmFactory, ingestion);
    await svc.generateEdges('p1');
    expect(ingestion.writeInferredEdges).toHaveBeenCalledWith('p1', [{ sourcePath: 'docs/a.md', targetPath: 'docs/b.md', reason: 'X' }]);
    expect(prisma.insight.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'edges_marker', docsTreeSha: 'h1' }) }));
  });
});
```

- [ ] **Step 2:** `cd apps/api && npx jest generate-edges` → FAIL.

- [ ] **Step 3: Implementar `generateEdges`** (no `InsightService`; injetar `IngestionService` no construtor — via `IngestionModule` exportado)

```ts
async generateEdges(projectId: string): Promise<void> {
  const project = await this.prisma.project.findUnique({ where: { id: projectId } });
  if (!project?.docsScopeHash) return;
  const hash = project.docsScopeHash;

  const marker = await this.prisma.insight.findFirst({ where: { projectId, kind: 'edges_marker', docsTreeSha: hash } });
  if (marker) return; // idempotente por hash

  const docs = await this.prisma.document.findMany({ where: { projectId }, select: { path: true, content: true } });
  if (docs.length < 2) return;

  // metadados leves p/ o prompt (título, headings, excerpt)
  const docMeta = docs.map((d) => ({ path: d.path, ...summarizeDoc(d.content) }));
  const explicit = await this.prisma.docLink.findMany({ where: { projectId, kind: 'explicit' }, select: { source: { select: { path: true } }, targetPath: true } });
  const explicitPairs = explicit.map((l) => ({ source: l.source.path, target: l.targetPath }));

  const client = this.llmFactory.create(await this.settings.providerOf(project.userId));
  const edges = await this.completeEdges(client, docMeta, explicitPairs); // 1 retry

  await this.ingestion.writeInferredEdges(projectId, edges);
  await this.prisma.insight.create({ data: { projectId, kind: 'edges_marker', docsTreeSha: hash, provider: client.provider, model: 'edges', inputTokens: 0, outputTokens: 0, content: {} as any } });
}
```

> `summarizeDoc(content)` = helper que extrai título (primeiro `# `), headings (`## `), e excerpt (~40 primeiras linhas). Colocar em `insight/domain`. `completeEdges` = padrão de `completeWithRetry` do resumo, mas com `EDGES_SYSTEM`/`buildEdgesUser`/`parseEdges` e cap de tokens via `selectContext` sobre os excerpts. Confirme a relação `source` no `docLink.findMany` (nome real da relação no schema).

- [ ] **Step 4: Listener + worker** — em `insight.worker.ts`: o `@OnEvent(DOCS_SYNCED)` enfileira também `edges` (`jobId: ${projectId}_edges_${hash}`); o `process` roteia por `job.name` (`summary` → generateSummary, `edges` → generateEdges).

- [ ] **Step 5:** `cd apps/api && npx jest generate-edges && npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/insight
git commit -m "insight: generateEdges — job de arestas semânticas (idempotente por hash)"
```

---

### Task 5: API graph estendido + DELETE edges

**Files:**
- Modify: `apps/api/src/modules/ingestion/application/ingestion.service.ts` (`graph()`)
- Modify: `apps/api/src/modules/ingestion/presentation/ingestion.controller.ts`
- Test: `apps/api/src/modules/ingestion/application/graph-edges.spec.ts`

- [ ] **Step 1: Teste** — `graph()` retorna edges com `kind`/`reason`; suprimidas não vêm (já excluídas do store).

```ts
// graph-edges.spec.ts — foco no shape: edges têm kind e reason
it('graph edges trazem kind e reason', async () => {
  const prisma = {
    project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
    document: { findMany: jest.fn().mockResolvedValue([{ id: 'a', path: 'docs/a.md', isConventional: false }]) },
    docLink: { findMany: jest.fn().mockResolvedValue([{ sourceDocumentId: 'a', targetDocumentId: 'b', targetPath: 'docs/b.md', kind: 'inferred', reason: 'X' }]) },
  } as any;
  const svc = new IngestionService(prisma, {} as any);
  const out = await svc.graph('u1', 'p1');
  expect(out.edges[0]).toMatchObject({ kind: 'inferred', reason: 'X' });
});
```

- [ ] **Step 2:** FAIL → **Step 3: Implementar** — no `graph()`, o `docLink.findMany` seleciona também `kind` e `reason`; o `.map` das edges inclui `kind: l.kind, reason: l.reason ?? null`. No controller:

```ts
@Delete('graph/edges')
@HttpCode(202)
async suppressEdge(@Req() req: AuthenticatedRequest, @Param('id') projectId: string, @Body() body: { sourcePath: string; targetPath: string }) {
  await this.ingestion.assertOwnerPublic(req.userId, projectId); // ou o padrão de ownership existente
  if (!body?.sourcePath || !body?.targetPath) throw new BadRequestException('sourcePath e targetPath obrigatórios');
  await this.ingestion.suppressEdge(projectId, body.sourcePath, body.targetPath);
}
```

> Ownership: seguir o padrão do controller (as outras rotas validam via service). Ajuste à forma real de assertOwner.

- [ ] **Step 4:** `cd apps/api && npx jest graph-edges && npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion
git commit -m "ingestion: graph com kind/reason nas edges + DELETE /graph/edges (supressão)"
```

---

### Task 6: Front — grafo com arestas inferidas

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/workspace/GraphTab.tsx`

- [ ] **Step 1: api.ts** — `GraphEdge` ganha `kind: 'explicit'|'inferred'` e `reason: string | null`; método `suppressEdge(projectId, sourcePath, targetPath)` (DELETE com body).

- [ ] **Step 2: GraphTab** — (LEIA o GraphTab atual primeiro para o padrão de react-flow/estilos)
  - Arestas `kind==='inferred'`: `strokeDasharray` tracejado, cor `var(--color-warning)`, largura menor; explícitas seguem sólidas.
  - Tooltip no hover da aresta inferida com o `reason`.
  - Ação "Remover relação" (botão no hover/menu) → `ConfirmDialog` → `api.suppressEdge` → remove a edge do estado local (otimista) + toast; erro → reverte + toast.
  - Chip "N inferidas" com toggle (checkbox/switch) que filtra as tracejadas do render (estado local `useState`).

- [ ] **Step 3:** `cd apps/web && npm run build` → limpo.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/workspace/GraphTab.tsx
git commit -m "web: grafo com arestas inferidas (tracejadas âmbar, tooltip, remover, toggle)"
```

**⛳ Checkpoint eixo A** — validar no rrb-adv: sync gera arestas tracejadas com motivo; remover uma → some; re-sync → não volta (SuppressedLink).

---

## FASE 2 — Eixo B: nível 3 da escada

### Task 7: writeInferredResolution no IngestionService

**Files:**
- Modify: `apps/api/src/modules/ingestion/application/ingestion.service.ts`
- Test: `apps/api/src/modules/ingestion/application/inferred-resolution.spec.ts`

**Interfaces:**
- Produces: `IngestionService.writeInferredResolution(projectId, entity, path, confidence): Promise<void>` — UPDATE da linha `DocumentResolution` da entidade (que era `absent`) p/ `level:3, source:'inference', path, confidence`. Só se a linha atual é `absent` (guarda — nunca sobrescreve config/alias/convenção).

- [ ] **Step 1: Teste**

```ts
it('atualiza linha absent p/ nível 3 inference', async () => {
  const prisma = {
    documentResolution: {
      findUnique: jest.fn().mockResolvedValue({ source: 'absent', level: 4 }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const svc = new IngestionService(prisma, {} as any);
  await svc.writeInferredResolution('p1', 'architecture', 'docs/notas.md', 0.7);
  expect(prisma.documentResolution.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ level: 3, source: 'inference', path: 'docs/notas.md' }) }));
});
it('NÃO sobrescreve linha config/alias/convention', async () => {
  const prisma = { documentResolution: { findUnique: jest.fn().mockResolvedValue({ source: 'config', level: 1 }), update: jest.fn() } } as any;
  const svc = new IngestionService(prisma, {} as any);
  await svc.writeInferredResolution('p1', 'architecture', 'docs/x.md', 0.7);
  expect(prisma.documentResolution.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2:** FAIL → **Step 3: Implementar** — findUnique por `projectId_entity`; se `source !== 'absent'`, return (guarda). Senão update p/ `{ level: 3, source: 'inference', path, confidence }`.

- [ ] **Step 4:** `cd apps/api && npx jest inferred-resolution` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion/application/ingestion.service.ts apps/api/src/modules/ingestion/application/inferred-resolution.spec.ts
git commit -m "ingestion: writeInferredResolution — nível 3 só sobre linhas absent (ADR-014)"
```

---

### Task 8: classify-prompt + classifyAbsent

**Files:**
- Create: `apps/api/src/modules/insight/domain/classify-prompt.ts` + `.spec.ts`
- Modify: `apps/api/src/modules/insight/application/insight.service.ts`
- Modify: `apps/api/src/modules/insight/infrastructure/insight.worker.ts` (enfileira `classify`)
- Test: `apps/api/src/modules/insight/application/classify-absent.spec.ts`

**Interfaces:**
- Produces: `parseClassify(text): ClassifyHit[]` (`{ entity, path, spans: string[] }`); `InsightService.classifyAbsent(projectId): Promise<void>`.

- [ ] **Step 1: Teste do parse** — array `[{entity,path,spans}]`; descarta sem spans (ADR-012); descarta entity fora do conjunto; descarta `deploy`.

- [ ] **Step 2:** FAIL → **Step 3: Implementar prompt+parse** (padrão edges). `CLASSIFY_SYSTEM`: "dado docs livres e uma entidade ausente, algum doc É essa entidade pelo conteúdo? cite spans; sem spans não afirme". `parseClassify` exige `spans` não-vazio.

- [ ] **Step 4: Teste do classifyAbsent** — idempotente por hash (`classify_marker`); pega entidades `absent` (via ingestion) exceto deploy; chama IA; entrega `writeInferredResolution` por hit; guarda spans no Insight.

- [ ] **Step 5:** FAIL → **Step 6: Implementar `classifyAbsent`** — lê entidades ausentes via `ingestion.resolutionOf` (as `absent`, exceto deploy); docs livres (paths que não são o path resolvido de nenhuma entidade); IA; por hit chama `ingestion.writeInferredResolution` + persiste spans em `Insight kind:'classify_marker'` (ou linha própria com content=spans). Listener enfileira `classify`.

- [ ] **Step 7:** `cd apps/api && npx jest classify && npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/insight
git commit -m "insight: classifyAbsent — nível 3 da escada (classificação semântica, spans obrigatórios)"
```

---

### Task 9: getTab lê nível 3 + UI das abas (badge inference + spans + corrigir)

**Files:**
- Modify: `apps/api/src/modules/board/application/tabs.service.ts` (source `inference` no payload + spans)
- Modify: `apps/web/src/pages/workspace/TabFrame.tsx` (branch `source==='inference'`)
- Modify: abas Arquitetura/Design/Decisões (já consomem TabFrame)

- [ ] **Step 1:** `resolutionOf` já devolve a linha nível 3 (é UPDATE de linha existente). `tabs.service` inclui no `source` do payload `source:'inference'` + os spans (lê do Insight). `getTab` para markdown/decisões funciona igual (o path resolvido pela IA aponta um doc real).

- [ ] **Step 2: TabFrame** — quando `source==='inference'`: linha âmbar "Inferido por IA — este documento foi classificado como \<entidade\> pelo conteúdo" + os spans citados (trechos) + botão "não é isso — corrigir" que abre a tela de mapeamento (Fatia 6) focada na entidade.

- [ ] **Step 3:** `cd apps/web && npm run build` + `cd apps/api && npx tsc --noEmit && npm run build` → limpo.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/board/application/tabs.service.ts apps/web/src/pages/workspace
git commit -m "board+web: abas renderizam resolução nível 3 (badge âmbar + spans + corrigir)"
```

**⛳ Checkpoint eixo B** — repo com doc de nome não-reconhecido: a IA classifica, a aba mostra o conteúdo com badge âmbar + spans; "corrigir" grava config.yml e a config vence no re-sync.

---

## FASE 3 — Eixo C: fallback Arquitetura/Design

### Task 10: fallback-prompt + generateFallback

**Files:**
- Create: `apps/api/src/modules/insight/domain/fallback-prompt.ts`
- Modify: `insight.service.ts` (`generateFallback`, `latestFallback`), `insight.worker.ts` (enfileira `fallback`)
- Test: `apps/api/src/modules/insight/application/generate-fallback.spec.ts`

**Interfaces:**
- Produces: `InsightService.generateFallback(projectId, entity: 'architecture'|'design')`; `latestFallback(userId, projectId, entity)`.

- [ ] **Step 1: Teste** — idempotente por hash (Insight kind = `${entity}_fallback` do docsTreeSha); só gera se a entidade está ausente; persiste markdown versionado.

- [ ] **Step 2:** FAIL → **Step 3: Implementar** — `FALLBACK_SYSTEM` (gera visão markdown de arquitetura/design a partir dos docs); `selectContext` cap; persiste em `Insight` (`kind`, `docsTreeSha`, `content` markdown, provider/model/tokens). 1 retry (markdown é livre — retry só em erro de chamada, não de parse). Listener enfileira `fallback` para architecture e design se ausentes.

- [ ] **Step 4:** `cd apps/api && npx jest generate-fallback && npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/insight
git commit -m "insight: generateFallback — visão inferida de Arquitetura/Design (versionada)"
```

---

### Task 11: getTab com fallback + POST promote

**Files:**
- Modify: `apps/api/src/modules/board/application/tabs.service.ts`
- Modify: `apps/api/src/modules/board/presentation/tabs.controller.ts`
- Test: `apps/api/src/modules/board/application/tabs-fallback.spec.ts`

**Interfaces:**
- Produces: `getTab` retorna `{ markdown, inferred: true }` quando ausente + há fallback; `POST /tabs/:tab/promote`.

- [ ] **Step 1: Teste** — architecture ausente + fallback existe → payload `inferred:true` com markdown; ausente sem fallback → null.

- [ ] **Step 2:** FAIL → **Step 3: Implementar** — no early-return de `level===4` do `getTab` (Fatia 6), para `architecture`/`design`: se `insight.latestFallback` existe pro hash → `{ source:{...}, payload: { markdown, inferred: true } }`. `promote`: body `{ content }` → write-back compartilhado commita `docs/ARCHITECTURE.md`/`docs/DESIGN.md` (installation token) + enqueueSync. Conflito → padrão. Rota no controller com ownership.

- [ ] **Step 4:** `cd apps/api && npx jest tabs-fallback && npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/board
git commit -m "board: getTab com fallback inferido + POST /tabs/:tab/promote (write-back)"
```

---

### Task 12: Front — abas Arquitetura/Design com fallback + promover

**Files:**
- Modify: `apps/web/src/lib/api.ts` (`promote`)
- Modify: `apps/web/src/pages/workspace/tabs/ArchitectureTab.tsx`, `DesignTab.tsx`

- [ ] **Step 1: api.ts** — `promote(projectId, tab, content)`.
- [ ] **Step 2: abas** — quando payload `inferred:true`: badge âmbar "inferido por IA · \<provider>" no header + botão "Promover a documento" (abre editor com preview markdown — reusar o editor/dialog da Fatia 3) → `promote` → após re-sync (syncNonce), badge some. "Regenerar" com `ConfirmDialog`.
- [ ] **Step 3:** `cd apps/web && npm run build` → limpo.
- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/workspace/tabs
git commit -m "web: Arquitetura/Design com fallback inferido (badge âmbar + promover + regenerar)"
```

**⛳ Checkpoint eixo C** — projeto sem ARCHITECTURE.md: aba mostra conteúdo inferido + badge; promover commita e após re-sync o badge some.

---

## FASE 4 — Aceite

### Task 13: Suíte + builds + aceite runtime

- [ ] **Step 1:** `cd apps/api && npx jest && npx tsc --noEmit && npm run build`; `cd apps/web && npm run build` → tudo verde/limpo.
- [ ] **Step 2: Validação runtime** (app de pé, sync do rrb-adv):
  - [ ] Arestas tracejadas âmbar com motivo no tooltip; explícitas sólidas.
  - [ ] Remover aresta inferida → some; re-sync → não volta (`SELECT * FROM suppressed_links`).
  - [ ] Mesmo hash → 0 nova chamada de IA (2º sync noop não re-gera).
  - [ ] Doc de nome não-convencional → classificado nível 3, aba com badge âmbar + spans; "corrigir" grava config.yml.
  - [ ] Projeto sem ARCHITECTURE.md → aba com conteúdo inferido + badge; promover commita, badge some após re-sync.
  - [ ] JSON inválido simulado → 1 retry; persistindo → erro amigável sem afetar explícitas.
  - [ ] Toggle esconde só as tracejadas.
- [ ] **Step 3:** correções pontuais que a validação exigir (cada uma seu commit).

### Task 14: docs + fecho

- [ ] **Step 1:** DEVELOPMENT.md (Fatia 7 itens → feito + aceite runtime), STATUS.md (Fatia 7 → Feito).
- [ ] **Step 2: Commit**

```bash
git add docs/DEVELOPMENT.md docs/STATUS.md
git commit -m "docs: Fatia 7 entregue — DEVELOPMENT.md + STATUS.md"
```

---

## Self-Review (autor do plano)

**Cobertura da SPEC-007:**
- Nível 3 (classificação, spans, perde p/ config, nunca deploy) → Tasks 7,8,9. ✔
- Arestas semânticas (job batch, DocLink inferred+reason, supressão) → Tasks 2,3,4,5,6. ✔
- SuppressedLink persiste, não ressuscita → Task 2 (writeInferredEdges exclui) + Task 13 (aceite). ✔
- Grafo web (tracejadas âmbar, tooltip, remover, toggle) → Task 6. ✔
- Fallback Arq/Design (Insight versionado, badge, promover, regenerar) → Tasks 10,11,12. ✔
- Idempotência por hash (0 IA em mesmo hash) → markers Tasks 4,8,10 + Task 13. ✔
- JSON inválido → 1 retry sem afetar explícitas → parse+retry Tasks 3,8 + Task 13. ✔
- API (`DELETE graph/edges`, `POST promote`) → Tasks 5,11. ✔
- Fronteira ADR-001 → Tasks 2,7 (métodos públicos), insight nunca toca stores. ✔

**Placeholder scan:** os `- [ ]` são passos/critérios. Pontos "ajuste à assinatura real / confirme a relação no schema" são verificações de integração contra código existente, com referência dada — não são TODOs de design.

**Consistência de tipos:** `InferredEdge`/`InferredEdgeInput` (sourcePath/targetPath/reason) consistente entre edges-prompt (Task 3), writeInferredEdges (Task 2), generateEdges (Task 4). `writeInferredResolution` assinatura idêntica Task 7↔8. `Insight.kind` markers (edges_marker/classify_marker) + fallbacks consistentes com a migration (Task 1).
