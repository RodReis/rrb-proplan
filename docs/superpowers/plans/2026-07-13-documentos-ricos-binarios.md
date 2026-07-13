# Documentos ricos — preview de binários — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar preview de binários (PDF, imagem, HTML, `.docx`) na aba Documentos, buscando os bytes sob demanda do GitHub — sem persistir binário no banco e sem executar HTML no domínio do ProPlan.

**Architecture:** O sync classifica cada arquivo por extensão (`classifyKind`); markdown segue o fluxo atual (baixa+persiste), binário grava só metadado (campo `kind`, sem baixar). Um endpoint `GET /documents/raw?path=` busca o blob do GitHub na hora (user token) e faz stream com Content-Type correto; `.docx` é a exceção (mammoth extrai texto). O front ramifica o viewer por `kind`.

**Tech Stack:** NestJS + TypeScript (jest) · Prisma/PostgreSQL · React + Vite · mammoth (extração de docx) · GitHub Git Blobs API.

## Global Constraints

- **Idioma**: docs/specs/commits/comunicação em pt-BR; código e identificadores em inglês. (CLAUDE.md)
- **Nunca persistir bytes de binário** no Postgres — banco guarda só metadado; bytes buscados sob demanda. (Decisão 1)
- **Sync não baixa binário** — só markdown/texto tem `content` baixado. Binário: `content: ''`, `byteSize: 0`. (Decisão 2)
- **HTML nunca executa no domínio do ProPlan**: iframe `sandbox=""` (front) + CSP no response (back). (Decisão 3)
- **Escrita nunca aqui**: tudo é leitura com **user token** (respeita visibilidade), nunca installation token. O `raw` só serve paths que já estão no índice `documents` do projeto do usuário. (ADR-015)
- **Ownership** (`assertOwner` id+userId) em toda rota nova. (padrão do projeto)
- **Sem regressão no markdown**: só o binário muda de caminho; markdown (com Mermaid) intocado.
- **Estrutura por módulo**: `presentation/` · `application/` · `domain/` · `infrastructure/`. Testes junto (`*.spec.ts`).
- **Portas**: web 5180, API 3311, Postgres 5433, Redis 6380. API lê `apps/api/.env`.
- **Commits**: pt-BR, imperativo, prefixo do módulo (`ingestion:`, `web:`).

---

## Estrutura de arquivos

**Back — `apps/api/src/modules/ingestion/`**
- `domain/document-kind.ts` (novo) — `DocKind`, `classifyKind`.
- `infrastructure/github-git.client.ts` (modificar) — `getRawBlob`.
- `application/sync.service.ts` (modificar) — classifica no loop; binário só metadado.
- `application/ingestion.service.ts` (modificar) — `kind` no `listDocuments`; `rawBlob`/`docxText`.
- `presentation/ingestion.controller.ts` (modificar) — `GET /documents/raw`.
- `ingestion.module.ts` — (mammoth não precisa de provider; import direto).

**Prisma**
- `schema.prisma` (modificar) — `Document.kind`.
- migration `documentos_ricos_kind`.

**Front — `apps/web/src/`**
- `lib/api.ts` (modificar) — `DocKind`, `kind` no `DocumentSummary`, `rawUrl`, `docxText`.
- `pages/workspace/DocumentsTab.tsx` (modificar) — `DocumentViewer` ramifica por kind.

**Deps novas**: `mammoth` (back).

---

## Task 1: Classificação de tipo

**Files:**
- Create: `apps/api/src/modules/ingestion/domain/document-kind.ts`
- Test: `apps/api/src/modules/ingestion/domain/document-kind.spec.ts`

**Interfaces:**
- Produces: `DocKind`, `classifyKind(path: string): DocKind`.

- [ ] **Step 1: Escrever os testes**

```ts
// apps/api/src/modules/ingestion/domain/document-kind.spec.ts
import { classifyKind } from './document-kind';

describe('classifyKind', () => {
  it('markdown/texto', () => {
    expect(classifyKind('docs/README.md')).toBe('markdown');
    expect(classifyKind('a.markdown')).toBe('markdown');
    expect(classifyKind('notes.txt')).toBe('markdown');
    expect(classifyKind('.github/workflows/ci.yml')).toBe('markdown');
    expect(classifyKind('x.yaml')).toBe('markdown');
  });
  it('pdf', () => expect(classifyKind('docs/spec.PDF')).toBe('pdf'));
  it('image', () => {
    expect(classifyKind('docs/logo.png')).toBe('image');
    expect(classifyKind('a.JPG')).toBe('image');
    expect(classifyKind('i.svg')).toBe('image');
    expect(classifyKind('w.webp')).toBe('image');
  });
  it('html', () => {
    expect(classifyKind('docs/report.html')).toBe('html');
    expect(classifyKind('r.htm')).toBe('html');
  });
  it('office (docx)', () => expect(classifyKind('docs/Requisito.docx')).toBe('office'));
  it('binary: xlsx, pptx, sem extensão, desconhecido', () => {
    expect(classifyKind('a.xlsx')).toBe('binary');
    expect(classifyKind('a.pptx')).toBe('binary');
    expect(classifyKind('LICENSE')).toBe('binary');
    expect(classifyKind('a.zip')).toBe('binary');
  });
});
```

- [ ] **Step 2: Rodar — falha.** `cd apps/api && npx jest document-kind` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/ingestion/domain/document-kind.ts

/** Tipo de documento para tratamento no sync e preview no viewer. */
export type DocKind = 'markdown' | 'pdf' | 'image' | 'html' | 'office' | 'binary';

const EXT: Record<string, DocKind> = {
  md: 'markdown', markdown: 'markdown', txt: 'markdown', yml: 'markdown', yaml: 'markdown',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image',
  html: 'html', htm: 'html',
  docx: 'office',
};

/**
 * Classifica o documento pela extensão (case-insensitive). Só `markdown` é
 * baixado e persistido no sync (alimenta abas/grafo/resolução); o resto grava
 * só metadado e ganha preview sob demanda. Sem extensão / desconhecido → binary.
 */
export function classifyKind(path: string): DocKind {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'binary';
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT[ext] ?? 'binary';
}
```

- [ ] **Step 4: Rodar — passa.** `cd apps/api && npx jest document-kind` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion/domain/document-kind.ts apps/api/src/modules/ingestion/domain/document-kind.spec.ts
git commit -m "ingestion: classificação de tipo de documento por extensão"
```

---

## Task 2: Prisma — Document.kind

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Document`)

**Interfaces:**
- Produces: `Document.kind String @default("markdown")`.

- [ ] **Step 1: Adicionar o campo** — em `model Document`, após `isConventional`:

```prisma
  kind           String   @default("markdown")
```

- [ ] **Step 2: Migration**

Run: `cd apps/api && npx prisma migrate dev --name documentos_ricos_kind`
Expected: cria e aplica a migration, regenera o client. Se pedir reset do banco, PARE e reporte BLOCKED (há dados de projetos).

> Nota de ambiente: se o `prisma generate` falhar com `EPERM` (DLL do query engine travada por processos `nest start` órfãos no Windows), o controller mata os processos e roda `npx prisma generate` manualmente. A migration já terá aplicado.

- [ ] **Step 3: Verificar** — `cd apps/api && npx tsc --noEmit` → sem erro (client conhece `kind`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "ingestion: Document.kind (migration documentos_ricos_kind)"
```

---

## Task 3: Sync classifica; binário só metadado

**Files:**
- Modify: `apps/api/src/modules/ingestion/application/sync.service.ts`

**Interfaces:**
- Consumes: `classifyKind`.

- [ ] **Step 1: Ler o `sync.service.ts`** para localizar o loop de download (o `for (const entry of [...added, ...updated])` que chama `getBlob` e faz `upsert`). O trecho atual baixa TODO blob.

- [ ] **Step 2: Alterar o loop** — classificar antes de baixar; binário grava só metadado, sem `getBlob`:

```ts
import { classifyKind } from '../domain/document-kind';
// ...
for (const entry of [...added, ...updated]) {
  const kind = classifyKind(entry.path);

  if (kind !== 'markdown') {
    // Binário: só metadado, NÃO baixa os bytes (Decisão 2). content vazio,
    // byteSize 0 — o tamanho real aparece quando o preview busca sob demanda.
    await this.prisma.document.upsert({
      where: { projectId_path: { projectId: project.id, path: entry.path } },
      create: {
        projectId: project.id, path: entry.path, blobSha: entry.blobSha,
        content: '', frontmatter: Prisma.JsonNull, isConventional: false,
        byteSize: 0, kind,
      },
      update: {
        blobSha: entry.blobSha, content: '', frontmatter: Prisma.JsonNull,
        isConventional: false, byteSize: 0, kind,
      },
    });
    continue;
  }

  // markdown: fluxo atual (getBlob → parseFrontmatter → content preenchido) +
  // gravar kind: 'markdown' no create/update.
  const blob = await this.git.getBlob(token, project.owner, project.name, entry.blobSha);
  if (blob === null) { skipped++; /* log existente */ continue; }
  const fm = parseFrontmatter(blob.content);
  const frontmatter = (fm.data ?? Prisma.JsonNull) as Prisma.InputJsonValue;
  await this.prisma.document.upsert({
    where: { projectId_path: { projectId: project.id, path: entry.path } },
    create: {
      projectId: project.id, path: entry.path, blobSha: entry.blobSha,
      content: blob.content, frontmatter, isConventional: fm.isConventional,
      byteSize: blob.byteSize, kind: 'markdown',
    },
    update: {
      blobSha: entry.blobSha, content: blob.content, frontmatter,
      isConventional: fm.isConventional, byteSize: blob.byteSize, kind: 'markdown',
    },
  });
}
```

> Preserve o resto do loop existente (o log de skip do cap 512KB no ramo markdown). Só adicione o ramo binário no topo e o `kind` nos upserts.

- [ ] **Step 3: Verificar** — `cd apps/api && npx tsc --noEmit && npx jest sync` (se houver spec de sync; senão só tsc) + `npm run build` → limpo.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/ingestion/application/sync.service.ts
git commit -m "ingestion: sync classifica tipo — binário grava só metadado, não baixa"
```

---

## Task 4: getRawBlob + endpoint raw + docx (mammoth)

**Files:**
- Modify: `apps/api/src/modules/ingestion/infrastructure/github-git.client.ts`
- Modify: `apps/api/src/modules/ingestion/application/ingestion.service.ts`
- Modify: `apps/api/src/modules/ingestion/presentation/ingestion.controller.ts`
- Test: `apps/api/src/modules/ingestion/application/raw-content.spec.ts`

**Interfaces:**
- Consumes: `GithubAuth.userToken`, `classifyKind`, `mammoth`.
- Produces: `GithubGitClient.getRawBlob(token, owner, repo, blobSha): Promise<Buffer>`; `IngestionService.rawBlob(userId, projectId, path)` (retorna `{ buffer, contentType, kind }` ou docx `{ text }`); `GET /projects/:id/documents/raw?path=`.

- [ ] **Step 1: Instalar mammoth** — `cd apps/api && npm install mammoth`

- [ ] **Step 2: `getRawBlob` no cliente GitHub** — adicionar ao `GithubGitClient`:

```ts
/** Bytes crus de um blob (Buffer), sem decodificar como texto — para binários
 *  servidos sob demanda no preview. Teto de sanidade de 25 MB (stream efêmero,
 *  nunca persistido). Diferente de getBlob, que força utf-8 e é só para texto. */
async getRawBlob(token: string, owner: string, repo: string, blobSha: string): Promise<Buffer> {
  const res = await this.fetchGithub(token, `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`);
  const body = (await res.json()) as { content: string; encoding: string; size: number };
  const MAX_RAW = 25 * 1024 * 1024;
  if (body.size > MAX_RAW) throw new Error(`Blob acima de 25 MB: ${body.size}`);
  return body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content);
}
```

- [ ] **Step 3: `rawBlob` no service** — adicionar ao `IngestionService`:

```ts
import * as mammoth from 'mammoth';
import { classifyKind } from '../domain/document-kind';
// injetar GithubGitClient e GithubAuth no construtor se ainda não estiverem
// (veja como o SyncService os injeta; o IngestionService pode não tê-los ainda).

const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp',
  html: 'text/html', htm: 'text/html',
};

/** Conteúdo bruto de um binário para preview. docx → texto extraído; demais →
 *  bytes + content-type. markdown → erro (usar documentContent). */
async rawContent(userId: string, projectId: string, path: string): Promise<
  | { type: 'stream'; buffer: Buffer; contentType: string; isHtml: boolean }
  | { type: 'docx'; text: string }
> {
  await this.assertOwner(userId, projectId);
  const doc = await this.prisma.document.findUnique({
    where: { projectId_path: { projectId, path } },
    select: { blobSha: true, kind: true },
  });
  if (!doc) throw new NotFoundException('Documento não encontrado');
  if (doc.kind === 'markdown') throw new BadRequestException('Use /documents/content para markdown');

  const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const token = await this.auth.userToken(project.userId);
  const buffer = await this.git.getRawBlob(token, project.owner, project.name, doc.blobSha);

  if (doc.kind === 'office') {
    const { value } = await mammoth.extractRawText({ buffer });
    return { type: 'docx', text: value };
  }
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  const contentType = CONTENT_TYPE[ext] ?? 'application/octet-stream';
  return { type: 'stream', buffer, contentType, isHtml: doc.kind === 'html' };
}
```

> Se `assertOwner`, `auth`, `git` não estão acessíveis no `IngestionService` hoje, injete-os (o `SyncService` já injeta `GithubAuth` e `GithubGitClient` do mesmo módulo — replique). Imports: `BadRequestException` de `@nestjs/common`.

- [ ] **Step 4: `kind` no listDocuments** — no `select` de `listDocuments`, adicionar `kind: true`.

- [ ] **Step 5: Endpoint no controller** — adicionar ao `IngestionController`:

```ts
import { Res } from '@nestjs/common';
import type { Response } from 'express';
// ...
@Get('documents/raw')
async documentRaw(
  @Req() req: AuthenticatedRequest,
  @Param('id') projectId: string,
  @Query('path') path: string,
  @Res() res: Response,
) {
  if (!path) throw new NotFoundException('Parâmetro path obrigatório');
  const out = await this.ingestion.rawContent(req.userId, projectId, path);
  if (out.type === 'docx') {
    res.json({ text: out.text });
    return;
  }
  res.set('Content-Type', out.contentType);
  res.set('Content-Disposition', 'inline');
  if (out.isHtml) {
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  }
  res.send(out.buffer);
}
```

- [ ] **Step 6: Teste** (mock de git/auth/prisma; foco na ramificação por kind + ownership):

```ts
// apps/api/src/modules/ingestion/application/raw-content.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IngestionService } from './ingestion.service';

function svc(overrides: any) {
  const prisma = {
    document: { findUnique: jest.fn().mockResolvedValue(overrides.doc) },
    project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r' }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r' }) },
  };
  const auth = { userToken: jest.fn().mockResolvedValue('tok') };
  const git = { getRawBlob: jest.fn().mockResolvedValue(overrides.buffer ?? Buffer.from('x')) };
  // construir o service com os mocks conforme a assinatura real do construtor
  return new IngestionService(prisma as any, /* queue */ {} as any, auth as any, git as any);
}

describe('IngestionService.rawContent', () => {
  it('markdown → BadRequest', async () => {
    const s = svc({ doc: { blobSha: 's', kind: 'markdown' } });
    await expect(s.rawContent('u1', 'p1', 'a.md')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('path inexistente → NotFound', async () => {
    const s = svc({ doc: null });
    await expect(s.rawContent('u1', 'p1', 'x.png')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('image → stream com content-type', async () => {
    const s = svc({ doc: { blobSha: 's', kind: 'image' }, buffer: Buffer.from([1, 2]) });
    const out = await s.rawContent('u1', 'p1', 'logo.png');
    expect(out).toMatchObject({ type: 'stream', contentType: 'image/png', isHtml: false });
  });
  it('html → isHtml true', async () => {
    const s = svc({ doc: { blobSha: 's', kind: 'html' } });
    const out = await s.rawContent('u1', 'p1', 'r.html');
    expect(out).toMatchObject({ type: 'stream', contentType: 'text/html', isHtml: true });
  });
});
```

> Ajuste a construção do `svc` à assinatura real do construtor do `IngestionService` (o número/ordem de deps injetadas). O docx com mammoth pode ficar sem teste unitário (exige buffer docx real) — cobrir na validação runtime.

- [ ] **Step 7: Rodar + build** — `cd apps/api && npx jest raw-content && npx tsc --noEmit && npm run build` → PASS + limpo.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ingestion apps/api/package.json apps/api/package-lock.json
git commit -m "ingestion: endpoint /documents/raw — stream de binário + docx via mammoth"
```

**⛳ Checkpoint back**: validar servindo um PDF/imagem real do rrb-adv (o controller conduz — sync o rrb-adv, `curl` autenticado no `/documents/raw?path=docs/design/logo/logo.png` retorna `image/png`).

---

## Task 5: Front — viewer ramifica por kind

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/workspace/DocumentsTab.tsx`

**Interfaces:**
- Consumes: `GET /documents/raw`.

- [ ] **Step 1: Tipos + métodos no `lib/api.ts`**

```ts
export type DocKind = 'markdown' | 'pdf' | 'image' | 'html' | 'office' | 'binary';
```

Adicionar `kind: DocKind;` à interface `DocumentSummary`. E no objeto `api`:

```ts
  rawUrl: (projectId: string, path: string) =>
    `${API_URL}/projects/${projectId}/documents/raw?path=${encodeURIComponent(path)}`,
  docxText: (projectId: string, path: string) =>
    request<{ text: string }>(`/projects/${projectId}/documents/raw?path=${encodeURIComponent(path)}`),
```

> `rawUrl` é síncrono (só monta a URL para `<iframe>`/`<img> src`). `docxText` faz fetch (o back devolve JSON para docx). Ambos apontam pro mesmo endpoint — o back decide pela `kind` do doc.

- [ ] **Step 2: `DocumentViewer` ramifica por kind** — no `DocumentsTab.tsx`, o `DocumentViewer` hoje sempre renderiza markdown. Trocar para ramificar. Precisa do `kind` do doc — o `DocumentViewer` recebe `path`; passe também o `kind` (a `DocTree`/lista já tem o `DocumentSummary` com `kind`). Ajuste a assinatura de `DocumentViewer` para `{ projectId, path, kind }` e o call-site.

```tsx
function DocumentViewer({ projectId, path, kind }: { projectId: string; path: string; kind: DocKind }) {
  if (kind === 'pdf')
    return <iframe src={api.rawUrl(projectId, path)} title={path} className="h-full w-full border-0" />;

  if (kind === 'image')
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:20px_20px] p-8">
        <img src={api.rawUrl(projectId, path)} alt={path} className="max-h-full max-w-full" />
      </div>
    );

  if (kind === 'html')
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border bg-warning/5 px-8 py-2 text-xs text-warning">
          Conteúdo isolado por segurança — scripts não são executados.
        </div>
        <iframe src={api.rawUrl(projectId, path)} title={path} sandbox="" className="flex-1 border-0" />
      </div>
    );

  if (kind === 'office') return <DocxViewer projectId={projectId} path={path} />;

  if (kind === 'binary')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium">Pré-visualização não disponível</p>
        <p className="max-w-md text-xs text-text-muted">{path}</p>
      </div>
    );

  // markdown (default) — MarkdownView com Mermaid, como hoje.
  return <MarkdownDoc projectId={projectId} path={path} />;
}
```

> `MarkdownDoc` = o corpo markdown atual do `DocumentViewer` (o fetch de `documentContent` + `MarkdownView`/`ReactMarkdown`). Extraia o que já existe para esse componente; não reescreva o render de markdown — reuse o atual (com Mermaid, se a Fatia 6 o adicionou ao viewer de Documentos; senão o `ReactMarkdown` existente).

- [ ] **Step 3: `DocxViewer`** (fetch do texto extraído):

```tsx
function DocxViewer({ projectId, path }: { projectId: string; path: string }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; text: string }>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    api.docxText(projectId, path)
      .then((r) => active && setState({ status: 'ready', text: r.text }))
      .catch((e) => active && setState({ status: 'error', message: String(e) }));
    return () => { active = false; };
  }, [projectId, path]);

  if (state.status === 'loading') return <div className="m-8 h-64 animate-pulse rounded-md bg-border/50" />;
  if (state.status === 'error') return <p className="m-8 text-sm text-error">Falha ao ler o documento: {state.message}</p>;
  return (
    <div className="px-8 py-6">
      <p className="mb-4 text-xs text-text-muted">Texto extraído — formatação e imagens omitidas.</p>
      <pre className="whitespace-pre-wrap font-sans text-sm text-text">{state.text}</pre>
    </div>
  );
}
```

- [ ] **Step 4: Passar `kind` ao viewer** — o call-site de `DocumentViewer` no `DocumentsTab` precisa do `kind` do doc selecionado. O componente que gerencia `selected` tem a lista `state.docs` (com `kind`). Achar o `DocumentSummary` do `selected` e passar `kind={doc.kind}`. Se `selected` não achar (nunca deve), default `'markdown'`.

- [ ] **Step 5: Build** — `cd apps/web && npm run build` → limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "web: viewer de Documentos ramifica por tipo (pdf, imagem, html sandbox, docx, binário)"
```

---

## Task 6: Docs + validação runtime + aceite

**Files:**
- Modify: `docs/DECISIONS.md` (emenda ao ADR-003), `docs/CONVENTION.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/STATUS.md`.

- [ ] **Step 1: Suíte + builds** — `cd apps/api && npx jest && npx tsc --noEmit && npm run build`; `cd apps/web && npm run build` → tudo verde/limpo.

- [ ] **Step 2: Validação runtime** (app de pé; sync o rrb-adv primeiro para o `kind` popular):
  - [ ] `docs/design/logo/logo.png` → renderiza como imagem.
  - [ ] `docs/Requisito.docx` → texto extraído legível.
  - [ ] `docs/design/mockup-builder-agentes-SPEC-025.html` (ou `docs/zap-report.html`) → renderiza em sandbox, sem executar script.
  - [ ] Um PDF (se houver no repo) → inline.
  - [ ] `.xlsx`/desconhecido → "pré-visualização não disponível".
  - [ ] `content` do binário vazio no banco (`SELECT path, kind, length(content) FROM documents WHERE kind != 'markdown'` → length 0).
  - [ ] Markdown continua com Mermaid (sem regressão).

- [ ] **Step 3: Emendas de doc**
  - ADR-003: adicionar parágrafo autorizando metadado de qualquer arquivo do escopo + stream sob demanda de documentos binários (pdf/imagem/html/docx); nunca persiste bytes, nunca lê código-fonte.
  - CONVENTION.md: nota sobre a aba Documentos listar todo arquivo de `docs/` (markdown alimenta abas/grafo; binário é só preview).
  - ARCHITECTURE.md: linha no `ingestion` (classifica tipo; binário = metadado + stream sob demanda).
  - DEVELOPMENT.md + STATUS.md: registrar a fatia entregue + aceite runtime.

- [ ] **Step 4: Commit final**

```bash
git add docs/
git commit -m "docs: documentos ricos entregue — emenda ao ADR-003 + aceite runtime"
```

---

## Self-Review (autor do plano)

**Cobertura do design**:
- Classificação por extensão → Task 1. ✔
- `kind` no Prisma → Task 2. ✔
- Sync binário só metadado → Task 3. ✔
- `getRawBlob` + endpoint raw + docx mammoth → Task 4. ✔
- Front por kind (pdf/image/html-sandbox/docx/binary) → Task 5. ✔
- HTML sandbox (front) + CSP (back) → Task 4 (CSP) + Task 5 (sandbox). ✔
- Ownership no raw → Task 4. ✔
- Storage sob demanda (nunca persiste bytes) → Task 3 (não baixa) + Task 4 (stream efêmero). ✔
- Emendas de doc → Task 6. ✔
- Critérios de aceite → Task 6 (validação runtime). ✔

**Placeholder scan**: os `- [ ]` são passos/critérios executáveis. Dois pontos marcados "ajuste à assinatura real do construtor" (teste do Task 4, injeção no `IngestionService`) são verificações de integração contra código existente, com a referência dada (`SyncService` injeta os mesmos) — não são TODOs de design.

**Consistência de tipos**: `DocKind` idêntico back (Task 1) e front (Task 5). `classifyKind`/`getRawBlob`/`rawContent`/`rawUrl`/`docxText` com as mesmas assinaturas onde referenciadas. `kind` no `Document` (Task 2) consumido no sync (Task 3), service (Task 4) e front (Task 5).
