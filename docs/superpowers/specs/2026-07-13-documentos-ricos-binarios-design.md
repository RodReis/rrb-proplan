---
proplan: v1
fatia: documentos-ricos
status: design-aprovado
updated: 2026-07-13
---
# Design — Documentos ricos: árvore + preview de binários

Achado no aceite runtime da Fatia 6 (2026-07-13): a lista de documentos era plana
(resolvido — `DocTree`, já entregue) e binários (`.pdf`, `.docx`, `.png`, `.html`)
apareciam como lixo no viewer porque o pipeline os lê como texto. Esta fatia dá
**preview de binários** com storage sob demanda.

> Não é bug da Fatia 6. Um binário em `docs/` não viola o ADR-003 (o path é
> autorizado); o que barra é técnico: `getBlob` força tudo a `toString('utf-8')`
> e o `content` do `Document` é texto. Esta fatia corrige o tratamento.

## Decisões do brainstorming (PI, 2026-07-13)

1. **Storage: não persistir bytes — buscar sob demanda.** O banco guarda só
   metadado do binário (path, sha, tamanho, kind), nunca os bytes. O preview
   busca o blob do GitHub na hora (user token) e faz stream pro browser. Casa
   com "banco = índice/cache" (CLAUDE.md); sync continua leve.
2. **Sync classifica por extensão; binário = só metadado.** Markdown/texto segue
   o fluxo atual (baixa, entra nas abas/grafo). Binário grava só metadado, sem
   baixar os bytes. Campo `kind` novo no `Document` distingue.
3. **HTML: iframe sandbox sem allow-scripts + CSP.** Renderiza layout/texto, JS
   não roda, sem acesso a cookies/origem do ProPlan.
4. **Tipos nesta fatia**: PDF (iframe nativo), imagem (`<img>`), HTML (sandbox),
   `.docx` (mammoth → texto). `.xlsx`/`.pptx` fora (YAGNI até aparecer real).
5. **Endpoint único** `GET /documents/raw?path=` faz stream com Content-Type
   dinâmico; docx é a exceção (extrai texto, devolve JSON).
6. **Ordem: back primeiro (Abordagem A)** — classificação + endpoint raw provados
   antes do front. Front vira `case` por kind no viewer.

## 1. Classificação de tipo (`ingestion/domain/document-kind.ts`)

Puro. `classifyKind(path: string): DocKind`.

```ts
type DocKind = 'markdown' | 'pdf' | 'image' | 'html' | 'office' | 'binary';
```

| kind | extensões | tratamento |
|---|---|---|
| `markdown` | `.md` `.markdown` `.txt` `.yml` `.yaml` | baixa + persiste conteúdo; abas/grafo/resolução |
| `pdf` | `.pdf` | metadado; preview iframe nativo |
| `image` | `.png` `.jpg` `.jpeg` `.gif` `.svg` `.webp` | metadado; preview `<img>` |
| `html` | `.html` `.htm` | metadado; preview iframe sandbox |
| `office` | `.docx` | metadado; preview texto via mammoth |
| `binary` | resto | metadado; sem preview, "abrir no GitHub" |

Case-insensitive; sem extensão → `binary`. Só `markdown` alimenta abas/grafo/
resolução — os demais nunca foram fonte de aba, então a escada (Fatia 6) e o
grafo os ignoram naturalmente.

**Emenda ao ADR-003**: a regra proíbe ler **conteúdo de código**; autoriza
**metadado de qualquer arquivo do escopo + stream sob demanda de documentos
binários** (pdf/imagem/html/docx). Nunca persiste bytes, nunca lê código-fonte.

## 2. Prisma + sync

### Prisma

```prisma
kind String @default("markdown") // markdown | pdf | image | html | office | binary
```

Migration `documentos_ricos_kind`. Default preserva os docs existentes
(recalculado no próximo sync).

### Sync (`sync.service.ts`)

No loop de `added`/`updated`, antes de baixar:

```ts
const kind = classifyKind(entry.path);
if (kind === 'markdown') {
  // fluxo atual: getBlob → parseFrontmatter → content preenchido
} else {
  // só metadado: content '', kind, byteSize 0, isConventional false — NÃO baixa
}
```

Zero download de binário no sync — tão leve quanto hoje. `byteSize` do binário
fica `0` (a Trees API não dá size barato; o tamanho real aparece no preview).
`rebuildLinks` e `ResolutionService.rebuild` já operam sobre conteúdo/markdown —
`content: ''` produz nenhum link e nenhuma resolução; seguros.

## 3. Endpoint raw (`GET /projects/:id/documents/raw?path=`)

`ingestion`. Fluxo:

1. `assertOwner(userId, projectId)`.
2. `Document` pelo path → `blobSha` + `kind`. 404 se não existe.
3. `office` (docx) → busca blob (user token), `mammoth.extractRawText({ buffer })`,
   devolve `{ text }` JSON.
4. `pdf`/`image`/`html` → busca blob raw, **stream dos bytes** com:
   - `Content-Type` por kind/extensão (`application/pdf`, `image/png`, `text/html`…)
   - HTML: `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'` (defesa em profundidade além do sandbox do front)
   - `Content-Disposition: inline`
5. `markdown` → 400 "use /documents/content".

**`GithubGitClient.getRawBlob(token, owner, repo, blobSha): Promise<Buffer>`** —
busca o blob e devolve os bytes (Buffer), **sem** o `.toString('utf-8')` que
corrompe binário. Teto de sanidade de 25 MB (stream efêmero, não persiste).
`office` reusa o buffer pro mammoth.

**Segurança**: só serve arquivos que estão no `documents` do projeto do usuário
(não é proxy arbitrário — o path tem que existir no índice, que só contém o
escopo autorizado). User token (respeita visibilidade), nunca installation token.

**Dep nova**: `mammoth` (back).

## 4. Front — viewer ramifica por kind

### `lib/api.ts`

- `DocumentSummary.kind: DocKind` (vem do `listDocuments`).
- `api.rawUrl(projectId, path): string` — URL do endpoint raw (pra `<iframe>`/
  `<img> src`), não faz fetch. O cookie de sessão vai no request do iframe/img.
- `api.docxText(projectId, path): Promise<{ text: string }>` — fetch do raw pro docx.

### `DocumentViewer` (em `DocumentsTab.tsx`) ramifica por `doc.kind`

- `markdown` → `MarkdownView` (atual, com Mermaid).
- `pdf` → `<iframe src={rawUrl} class="w-full h-full">`.
- `image` → `<img src={rawUrl}>` em container com fundo xadrez (PNG transparente).
- `html` → `<iframe src={rawUrl} sandbox="">` (**sandbox vazio** = sem scripts,
  sem same-origin, sem forms) + aviso "conteúdo isolado por segurança".
- `office` → fetch `docxText` → `<pre>`/prose + aviso "texto extraído —
  formatação e imagens omitidas".
- `binary` → ícone + nome + "Pré-visualização não disponível" + "Abrir no GitHub ↗".

Loading/erro por tipo (`onLoad`/`onError` no iframe/img). A árvore (`DocTree`)
não muda — só o viewer à direita passa a saber cada tipo.

## 5. Docs a emendar

- **ADR-003**: emenda autorizando metadado + stream sob demanda de binários.
- **CONVENTION.md**: nota — a aba Documentos lista todo arquivo de `docs/`;
  markdown alimenta abas/grafo, binário é só preview.
- **ARCHITECTURE.md**: linha no `ingestion` (classifica tipo; binário = metadado
  + stream sob demanda).

## Ordem de execução (Abordagem A)

1. `document-kind.ts` + testes.
2. Prisma `kind` + migration.
3. Sync classifica; binário só metadado (não baixa) + teste.
4. `getRawBlob` + endpoint `raw` (stream + content-type + mammoth) + testes →
   **validar servindo PDF/imagem real do rrb-adv** (checkpoint back).
5. Front: `kind` no api, `rawUrl`/`docxText`, `DocumentViewer` por kind.
6. Emendas de doc + validação runtime (`Requisito.docx`, `logo.png`,
   `zap-report.html`, um PDF) + aceite.

## Critérios de aceite

- [ ] `logo.png` renderiza como imagem (não lixo).
- [ ] `Requisito.docx` mostra texto extraído (não zip binário).
- [ ] `zap-report.html` renderiza em sandbox, legível, sem executar script.
- [ ] Um PDF renderiza inline.
- [ ] Sync **não** baixa binário — nenhum byte binário no Postgres; `content`
  vazio pro binário.
- [ ] `.xlsx`/desconhecido → "pré-visualização não disponível" + abrir no GitHub.
- [ ] `raw` respeita ownership (projeto de outro usuário → 404).
- [ ] Markdown continua renderizando com Mermaid (sem regressão).

## Fora de escopo

`.xlsx`/`.pptx` (outras libs, sem caso de uso). Persistir bytes. Object storage.
Edição de binário. Fidelidade de layout do docx (só texto). Thumbnail/OCR.

## Riscos e mitigações

- **XSS via HTML** → iframe `sandbox=""` (sem scripts/same-origin) + CSP no
  response. Dupla barreira.
- **Proxy arbitrário** → o raw só serve paths que estão no índice do projeto do
  usuário (escopo autorizado), com ownership.
- **Binário gigante** → teto de 25 MB no stream; não persiste.
- **Regressão no markdown** → só binário muda de caminho; markdown intocado.
  Critério de aceite explícito.
