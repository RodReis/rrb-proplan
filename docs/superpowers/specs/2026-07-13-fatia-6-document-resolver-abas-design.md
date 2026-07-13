---
proplan: v1
fatia: 6
spec: SPEC-006
status: design-aprovado
updated: 2026-07-13
---
# Design — Fatia 6: DocumentResolver + abas

Design de implementação da SPEC-006 (ampliada, `aprovada-pi`). Escopo travado pela
spec; este doc registra as **decisões técnicas** tomadas no brainstorming com o PI
em 2026-07-13 e o desenho de execução.

> **Fonte de verdade do escopo**: [SPEC-006](../../specs/SPEC-006-abas-convencao.md),
> [ADR-014](../../DECISIONS.md#adr-014), [CONVENTION.md](../../CONVENTION.md),
> [ARCHITECTURE.md](../../ARCHITECTURE.md). Onde este doc e a SPEC-006 divergirem em
> **redação**, vale o ARCHITECTURE.md (ver Decisão 1).

## Decisões do brainstorming (PI, 2026-07-13)

1. **Módulo do resolver: `ingestion`, não `board`.** A SPEC-006 escreve
   "`board/domain`", mas o ARCHITECTURE.md (regra de arquitetura do CLAUDE.md) é
   explícito e mais detalhado: `ingestion` **resolve e persiste** a fonte de cada
   entidade (níveis 1/2/4, determinísticos); `board` apenas **compõe as abas** a
   partir da resolução já persistida (`IngestionService.resolutionOf`); `insight`
   tem o slot do nível 3 (IA, Fatia 7). Seguir o ARCHITECTURE.md.

2. **Resolução persistida em tabela (`DocumentResolution`), cache derivado.** A
   frase da SPEC "sem tabela nova: o mapeamento mora no repo" refere-se ao
   **mapeamento do usuário** (a decisão dele → `.proplan/config.yml`, no repo,
   fonte de verdade). A **resolução calculada** é cache derivado — como
   `documents`, `doc_links` e `issues` já são. SPEC-006 corrigida pelo PI em
   2026-07-13. Critério que prova ser cache: apagar as linhas + re-sync reconstrói
   idêntico (nenhuma decisão do usuário perdida).

3. **Recálculo no fim de todo sync, síncrono.** Como `LinkService.rebuildLinks`
   (Fatia 4). Um lugar só, sempre consistente com `documents`. Sem job/evento
   próprio: a resolução é determinística e barata (sem IA).

4. **Tela de mapeamento dedicada + atalho nas abas nível 2.** Tela aberta por
   botão no header do workspace (padrão da tela Settings); a linha "reconhecido por
   nome — corrigir" das abas nível 2 abre a tela focada na entidade.

5. **Escrita do `.proplan/config.yml`: ler-mesclar-reescrever com gerador próprio.**
   Preserva as outras entidades e `proplan: v2`; reescreve o arquivo inteiro
   (como `projection.ts` gera o STATUS.md). Sem round-trip fiel de comentários —
   `.proplan/` é artefato do ProPlan, não vale o custo (a Fatia 5 já rejeitou
   round-trip fiel por ser o item mais caro).

6. **Ordem de entrega: vertical fina primeiro (Abordagem A).** Resolver +
   `DocumentResolution` + aba Arquitetura ponta-a-ponta (resolve → renderiza →
   Mermaid), validada no rrb-proplan, antes de replicar as outras 5 abas e a tela
   de mapeamento. Prova o eixo caro (resolução persistida + `GET /tabs` + render +
   Mermaid) cedo; cada aba seguinte é incremento sobre trilho testado.

---

## 1. DocumentResolver — o coração

`ingestion/domain/document-resolver.ts` — **puro**, sem I/O (recebe paths +
config parseado, devolve `Resolution[]`). Testado sem banco.

```ts
type Entity = 'architecture' | 'decisions' | 'design' | 'testing' | 'deploy' | 'skills';
type Source = 'convention' | 'alias' | 'config' | 'absent';

interface Resolution {
  entity: Entity;
  level: 1 | 2 | 4;         // nível 3 (IA) fica na Fatia 7
  source: Source;
  path: string | null;      // arquivo único
  paths: string[] | null;   // coleção (adr/*.md) — decisions pode usar
  confidence: number;       // 1.0 convenção · 0.8 alias · 1.0 config · 0 ausente
}
```

**Escada** (para no primeiro que resolve, por entidade):

1. **Config** — `.proplan/config.yml` tem a entidade? **Vence tudo** (checado
   primeiro). `null` explícito → `absent` (source `config`, confiança cheia:
   "sei que não existe, não perguntar de novo"). Path/dir → source `config`,
   confiança cheia.
2. **Convenção** — caminho exato (`docs/ARCHITECTURE.md`) **com** frontmatter
   `proplan: v1`. → nível 1, confiança 1.0.
3. **Alias** — tabela em código (abaixo). → nível 2, confiança 0.8.
4. **Ausente** — nada resolve. → nível 4, source `absent`, confiança 0.

> Config **antes** de convenção: a SPEC diz "config vence todos os níveis"; se ele
> mandar, nem se olha convenção/alias.

### Tabela de alias

`ingestion/domain/alias-table.ts` — constante em código (não config do usuário;
ampliar exige commit + teste). Case- e acento-insensitive. **Match do nome inteiro
sem extensão** — nunca substring.

| entidade | nomes (basename sem ext) | diretórios |
|---|---|---|
| architecture | `architecture`, `arquitetura`, `arch`, `design-doc` | `docs/arch/` |
| decisions | `decisions`, `decisoes` | `adr/`, `adrs/`, `decisions/`, `decisoes/`, `docs/adr/` |
| design | `design`, `ui`, `styleguide` | `docs/design-system/` |
| testing | `testing`, `testes`, `qa` | `docs/qa/` |
| deploy | `deploy`, `deployment`, `infra`, `runbook` | — |
| skills | `agents` (+ `CLAUDE.md`, `.claude/` sempre) | `.claude/` |

**Alias não-ganancioso** (SPEC exige teste explícito): compara basename sem
extensão contra a lista por **igualdade normalizada**, não substring.
`docs/archive/notas.md` → basename `notas`, dir `archive` — nada casa.
`archive` ≠ `arch`.

**Diretório como fonte** = primeira classe: `decisions` resolvida por `adr/`
devolve `paths` (todos os `.md` do diretório), não `path`.

### Fixtures de teste (TDD, resolver antes da UI)

- **repo-convenção** (rrb-proplan): tudo em nível 1, sem aviso de fonte.
- **repo-nomes-próprios**: `docs/arquitetura.md`, `adr/0001-x.md`,
  `docs/qa/estrategia.md`, **sem** frontmatter `proplan` → tudo nível 2. **É o
  teste que prova a fatia.**
- **repo-vazio**: tudo nível 4, nada inventa, nada quebra.

## 2. Persistência e recálculo

### Prisma

```prisma
model DocumentResolution {
  id         String   @id @default(cuid())
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  entity     String   // 'architecture' | 'decisions' | ...
  level      Int      // 1 | 2 | 4
  source     String   // 'convention' | 'alias' | 'config' | 'absent'
  path       String?
  paths      String[] // vazio = usa path
  confidence Float
  @@unique([projectId, entity])
}
```

Uma linha por entidade por projeto (6/projeto). Migration
`fatia_6_document_resolution`. Novo campo `Project.proplanConfigInvalid Boolean @default(false)`.

### ResolutionService.rebuild(projectId) — `ingestion/application`

1. lê `documents` do projeto (paths) + parseia `.proplan/config.yml` do cache de
   documents (ele está no escopo de sync — §5).
2. chama `DocumentResolver` (puro) → `Resolution[]`.
3. replace-all em transação (`deleteMany` + `createMany`), como `rebuildLinks`.

**Gatilho**: chamado no fim de todo run do `SyncService` (sucesso **e** noop),
junto de `rebuildLinks`.

### `.proplan/config.yml` inválido

`parseProplanConfig` nunca lança (try/catch) → devolve `null` (cai na escada) e
marca `Project.proplanConfigInvalid = true`. **Sync não falha** (SPEC exige). UI
avisa "config do ProPlan inválida neste repo".

### Contrato exposto ao board

`IngestionService.resolutionOf(projectId, entity): Promise<Resolution>` —
lê o cache, não re-resolve.

## 3. Parsers determinísticos

`ingestion/domain`, puros (conteúdo string → estrutura), sem tabelas novas, rodam
**na request** sobre o conteúdo já cacheado em `documents`. Testes com fixtures.

- **`decisions-index.ts`** — arquivo **ou** coleção. Arquivo (`DECISIONS.md`):
  fatia por `## ADR-NNN`/`## Título`; título + status + data quando parseáveis.
  Coleção (`adr/*.md`): um item/arquivo, título do H1/frontmatter. Saída comum:
  `{ title, status?, date?, path, anchor? }[]`.
- **`testing-doc.ts`** + **`workflow-parser.ts`** (fallback CI). Fonte resolvida →
  markdown. Sem fonte, com workflows → parseia `.github/workflows/*.yml`: `name`,
  `on`, jobs (`nome` + `runs-on`). Sem steps. Aviso "inferido do CI".
- **`deploy-doc.ts`** — parseia a tabela `## Ambientes` (Ambiente/Status/
  Plataforma/URL) → `{ env, status, platform, url }[]`. **Sem fallback de IA,
  nunca.** Sem fonte → vazio + CTA.
- **`skills-index.ts`** — determinístico (sem IA): `CLAUDE.md` (sempre),
  `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, e por alias `AGENTS.md`.
  `name` + `description` do frontmatter, agrupado (skills | agents). Nada →
  "não configurado".
- **Arquitetura / Design**: sem parser dedicado — renderizam markdown + Mermaid.

## 4. API e Mermaid

Endpoints no **`board`** (compõe abas via `resolutionOf`):

```
GET /projects/:id/tabs/:tab
  → { source: { level, source, path|paths, confidence }, payload }
  payload por aba:
    architecture|design → { markdown }
    decisions           → { items: [{title, status?, date?, path, anchor?}] }
    testing             → { markdown } | { ci: { workflows: [...] }, inferred: true }
    deploy              → { environments: [{env, status, platform, url}] }
    skills              → { skills: [...], agents: [...] }
  ausente → { source: {level:4, source:'absent'}, payload: null }

GET /projects/:id/mapping
  → por entidade: { entity, resolution, candidates: [...] }   // arquivos/dirs do repo

PUT /projects/:id/mapping   (202)
  body: { entity, path: string | null }   // null = marcar ausente
  → ler-mesclar-reescrever .proplan/config.yml (write-back) + re-sync
```

O front **não conhece a regra de resolução** — recebe `source` pronto; só decide
se mostra a linha "reconhecido por nome" (`source === 'alias'`).

`GET /tabs/:tab`: `board` pede `resolutionOf(projectId, entity)`, pega o(s)
document(s) do path/paths resolvido(s), roda o parser (§3), monta payload.

`PUT /mapping` (reusa write-back da Fatia 5):
1. `getFileSha('.proplan/config.yml')` (ou null).
2. lê conteúdo atual, parseia, **mescla** a entidade, reescreve YAML inteiro
   (gerador determinístico, `proplan: v2`).
3. `putFile` com installation token (identidade `proplan[bot]`).
4. `WritebackConflictError` → re-sync + 1 retry (padrão existente).
5. re-sync → recalcula `DocumentResolution` (§2).

**Mermaid** — client-side, no render de markdown (vale para Documentos e todas as
abas): lazy import de `mermaid` (só carrega com bloco ` ```mermaid `); render por
bloco; **erro de sintaxe → fallback pro código cru** (não derruba a aba). Dep nova
`mermaid` — a única da fatia; justificada pelo critério de aceite (diagrama
desenhado) e por hand-roll ser inviável.

## 5. Ingestion — escopo ampliado

`isInScope` (Fatia 2 cobre `README.md`, `CLAUDE.md`, `docs/**`) soma:

- **`.proplan/config.yml`** — mapeamento do usuário.
- **`.claude/**`** — filtro fino: só `skills/*/SKILL.md` e `agents/*.md`
  (não settings/hooks).
- **`.github/workflows/*.yml|*.yaml`** — fallback de Testes (só workflows).
- **diretórios de alias na raiz**: `adr/`, `adrs/`, `decisions/`, `decisoes/`;
  e arquivos de alias soltos na raiz (`AGENTS.md`, `CONTRIBUTING.md`,
  `RUNBOOK.md`, `ROADMAP.md`, `TODO.md`).

Mesmo pipeline, mesmo hash. Ampliar o escopo muda o `docs_tree_sha` → primeiro
sync pós-deploy repopula naturalmente.

**Frescor (ADR-010)** intacto: o cálculo usa `path=docs`; nenhum path novo está em
`docs/` (exceto `docs/adr/`, que já contava). `.proplan/`, `.claude/`, `.github/`
não contaminam o frescor.

## 6. Web — abas, Mermaid, tela de mapeamento

**Trilho comum**: `useTab(projectId, tab)` (fetch `GET /tabs/:tab`) + `<TabFrame>`:
- carregando → skeleton.
- `source === 'alias'` → linha discreta:
  `Fonte: docs/arquitetura.md (reconhecido por nome — corrigir)`; "corrigir" abre
  a tela de mapeamento focada na entidade.
- `level === 4` → empty state "não documentado" + CTA ("gerar por IA" desabilitado,
  tooltip "Fatia 7").
- nível 1 → nada.

**As 6 abas**:
- **Arquitetura / Design** → `MarkdownView` + Mermaid.
- **Decisões** (nova) → lista (título · status · data), clique abre o doc no
  `DocViewerPanel`.
- **Testes** → markdown, ou lista de workflows do CI com aviso "inferido do CI".
- **Deploy** → tabela de ambientes com badges (ativo=success, inativo=neutro).
  Sem fonte → CTA, nunca IA.
- **Skills & Agentes** → grupos Skills / Agents (nome + descrição). Nada →
  "não configurado".

**Registro** (`tabs.ts`): 6 abas já existem com `enabledIn: 6`; subir
`CURRENT_SLICE` 5 → 6 e adicionar `decisions`. Aviso de fonte vem do payload, não
do registro.

**Tela de mapeamento** (`MappingScreen`) — botão no header (ao lado de Sincronizar):
- 6 entidades: fonte + nível (badge: convenção / reconhecido por nome / manual /
  ausente) + confiança.
- por linha: **confirmar** · **trocar** (picker via `candidates`) · **marcar
  ausente**.
- salvar → `PUT /mapping` (202) → "salvando no repo…" (padrão Fatia 5) → re-sync →
  abas atualizam.
- visão do todo: "4 de 6 resolvidas · 2 ausentes".
- `proplanConfigInvalid` → banner "config do ProPlan inválida neste repo".
- atalho: "corrigir" das abas nível 2 abre a tela focada na entidade.

### Ordem de execução (Abordagem A)

1. `DocumentResolver` + `alias-table` + `DocumentResolution` (Prisma+service) +
   `GET /tabs/architecture` + aba Arquitetura + Mermaid → **validar no rrb-proplan**.
2. Replicar as outras 5 abas (parsers §3 + payloads §4).
3. `GET`/`PUT /mapping` + `MappingScreen` + atalho nas abas nível 2.
4. Fixture repo-nomes-próprios + critérios de aceite da SPEC-006.

## Critérios de aceite

Os da [SPEC-006](../../specs/SPEC-006-abas-convencao.md#critérios-de-aceite), **mais**:

- [ ] **Cache reconstrói idêntico** (Decisão 2): apagar todas as linhas de
  `DocumentResolution` + re-sync reconstrói a resolução idêntica — nenhuma decisão
  do usuário perdida (ela mora no `.proplan/config.yml`).

## Fora de escopo (reafirmado)

Nível 3 da escada (IA — Fatia 7). Qualquer chamada de IA. Edição de docs pelas
abas. Execução real de testes. Criação de `DEPLOY.md` pela UI. **Renomear, mover
ou reescrever qualquer doc do repo-alvo** — o único write é `.proplan/config.yml`.

## Riscos e mitigações

- **Alias ganancioso casa arquivo errado com confiança de `fato`** → match por
  nome inteiro (não substring) + teste explícito `archive` ≠ `arch` + o usuário
  revisa o mapeamento antes de valer.
- **Ruído de `.claude/`/`.github/`** inflando o cache → filtro fino (só
  `SKILL.md`/`agents/*.md`/`workflows/*.yml`).
- **Bundle inchado pelo Mermaid** → lazy import só quando há bloco mermaid.
- **YAML do config quebrado derrubando o sync** → parse tolerante, `null` + flag,
  sync segue.
