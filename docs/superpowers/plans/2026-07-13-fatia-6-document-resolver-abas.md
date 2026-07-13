# Fatia 6 — DocumentResolver + abas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver a fonte de cada aba do workspace pela escada do ADR-014 (convenção → alias → `.proplan/config.yml` → ausente) e renderizar as 6 abas restantes, funcionando em repos que não seguem a convenção — sem renomear um único arquivo do repo-alvo.

**Architecture:** `DocumentResolver` puro em `ingestion/domain` resolve cada entidade; `ResolutionService` persiste o resultado em `DocumentResolution` (cache derivado) no fim de todo sync, como `rebuildLinks`. O `board` compõe as abas via `IngestionService.resolutionOf`, rodando parsers determinísticos sobre o conteúdo já cacheado em `documents`. A tela de mapeamento escreve `.proplan/config.yml` via write-back compartilhado (installation token, bot). Entrega em vertical fina: Arquitetura ponta-a-ponta primeiro, depois as outras 5 abas, depois o mapeamento.

**Tech Stack:** NestJS + TypeScript (jest) · Prisma/PostgreSQL · React + Vite (react-markdown, remark-gfm, mermaid) · GitHub Contents API via fetch.

## Global Constraints

- **Idioma**: docs/specs/commits/comunicação em pt-BR; código e identificadores em inglês. (CLAUDE.md)
- **Sem hardcode, sem mock**: dado de dev entra via seed. (CLAUDE.md)
- **Nenhuma chamada de IA em toda a fatia.** O nível 3 da escada é a Fatia 7. (SPEC-006)
- **O ProPlan nunca renomeia, move ou reescreve doc do repo-alvo.** O único write é `.proplan/config.yml`. (ADR-014)
- **`DocumentResolver` e testes vêm PRIMEIRO**; as abas são consumidoras. (SPEC-006, notas técnicas)
- **Alias casa nome inteiro sem extensão, nunca substring** (`archive` ≠ `arch`). (SPEC-006)
- **Resolução é cache derivado**: apagar `DocumentResolution` + re-sync reconstrói idêntico. A decisão do usuário mora só em `.proplan/config.yml`, no repo. (Design, Decisão 2)
- **Estrutura por módulo**: `presentation/` · `application/` · `domain/` · `infrastructure/`. Testes junto (`*.spec.ts`). (CLAUDE.md)
- **Portas**: web 5180, API 3311, Postgres host 5433, Redis host 6380. API lê `apps/api/.env`.
- **Commits**: pt-BR, imperativo, prefixo do módulo (`ingestion:`, `board:`, `web:`).

---

## Estrutura de arquivos

**Back — `apps/api/src/modules/ingestion/`**
- `domain/entity.ts` (novo) — tipos `Entity`, `Source`, `Resolution`.
- `domain/alias-table.ts` (novo) — tabela de alias + `matchAlias`.
- `domain/document-resolver.ts` (novo) — `resolveDocuments` (puro).
- `domain/proplan-config.ts` (novo) — `parseProplanConfig`, `mergeProplanConfig`, `serializeProplanConfig`.
- `application/resolution.service.ts` (novo) — `rebuild(projectId)` (persiste).
- `application/ingestion.service.ts` (modificar) — expõe `resolutionOf`.
- `application/sync.service.ts` (modificar) — chama `resolution.rebuild` no fim (success + noop).
- `domain/scope-filter.ts` (modificar) — escopo ampliado.
- `ingestion.module.ts` (modificar) — provider `ResolutionService`.

**Back — `apps/api/src/modules/board/`**
- `domain/decisions-index.ts`, `domain/deploy-doc.ts`, `domain/skills-index.ts`, `domain/testing-doc.ts`, `domain/workflow-parser.ts` (novos) — parsers puros.
- `application/tabs.service.ts` (novo) — compõe payload por aba.
- `application/mapping.service.ts` (novo) — GET candidatos + PUT config.yml.
- `presentation/tabs.controller.ts` (novo) — `GET /tabs/:tab`, `GET/PUT /mapping`.
- `board.module.ts` (modificar) — providers + import do `IngestionModule`.

**Prisma**
- `schema.prisma` (modificar) — model `DocumentResolution` + `Project.proplanConfigInvalid`.
- migration `fatia_6_document_resolution`.

**Front — `apps/web/src/`**
- `lib/api.ts` (modificar) — tipos + métodos `tab`, `mapping`, `putMapping`.
- `pages/workspace/MarkdownView.tsx` (novo) — react-markdown + Mermaid (reusável).
- `pages/workspace/Mermaid.tsx` (novo) — render lazy de bloco mermaid.
- `pages/workspace/TabFrame.tsx` (novo) — trilho comum (skeleton/aviso de fonte/ausente).
- `pages/workspace/tabs/ArchitectureTab.tsx`, `DesignTab.tsx`, `DecisionsTab.tsx`, `TestsTab.tsx`, `DeployTab.tsx`, `SkillsTab.tsx` (novos).
- `pages/workspace/MappingScreen.tsx` (novo).
- `pages/workspace/tabs.ts` (modificar) — `CURRENT_SLICE` 5→6, add `decisions`.
- `pages/workspace/Workspace.tsx` (modificar) — wire das abas + botão Mapeamento.

**Deps novas**: `yaml` (back, serializar config.yml) · `mermaid` (front).

---

## FASE 1 — Vertical fina: resolver + Arquitetura ponta-a-ponta

### Task 1: Tipos de resolução

**Files:**
- Create: `apps/api/src/modules/ingestion/domain/entity.ts`

**Interfaces:**
- Produces: `Entity`, `Source`, `Resolution`, `ENTITIES` — consumidos por todas as tasks seguintes.

- [ ] **Step 1: Criar os tipos**

```ts
// apps/api/src/modules/ingestion/domain/entity.ts

/** As 6 entidades canônicas resolvidas nesta fatia (nível 3/IA é Fatia 7). */
export type Entity =
  | 'architecture'
  | 'decisions'
  | 'design'
  | 'testing'
  | 'deploy'
  | 'skills';

export const ENTITIES: Entity[] = [
  'architecture',
  'decisions',
  'design',
  'testing',
  'deploy',
  'skills',
];

/** Origem da resolução na escada do ADR-014. */
export type Source = 'convention' | 'alias' | 'config' | 'absent';

/** Resultado da resolução de uma entidade. Nível 3 (IA) não existe nesta fatia. */
export interface Resolution {
  entity: Entity;
  level: 1 | 2 | 4;
  source: Source;
  /** Arquivo único resolvido, ou null (coleção ou ausente). */
  path: string | null;
  /** Coleção de arquivos (ex.: adr/*.md); [] quando é arquivo único ou ausente. */
  paths: string[];
  /** 1.0 convenção · 0.8 alias · 1.0 config · 0 ausente. */
  confidence: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/ingestion/domain/entity.ts
git commit -m "ingestion: tipos de resolução de documentos (ADR-014)"
```

---

### Task 2: Tabela de alias + matchAlias (não-ganancioso)

**Files:**
- Create: `apps/api/src/modules/ingestion/domain/alias-table.ts`
- Test: `apps/api/src/modules/ingestion/domain/alias-table.spec.ts`

**Interfaces:**
- Consumes: `Entity` de `entity.ts`.
- Produces: `matchAlias(path: string): Entity | null` — casa o basename OU o diretório de um path com uma entidade, por igualdade normalizada (nunca substring).

- [ ] **Step 1: Escrever os testes (falham primeiro)**

```ts
// apps/api/src/modules/ingestion/domain/alias-table.spec.ts
import { matchAlias } from './alias-table';

describe('matchAlias', () => {
  it('casa nome exato sem extensão, case- e acento-insensitive', () => {
    expect(matchAlias('docs/arquitetura.md')).toBe('architecture');
    expect(matchAlias('ARCHITECTURE.md')).toBe('architecture');
    expect(matchAlias('docs/Arch.markdown')).toBe('architecture');
    expect(matchAlias('docs/DESIGN.md')).toBe('design');
    expect(matchAlias('docs/qa.md')).toBe('testing');
  });

  it('casa diretório de alias (coleção)', () => {
    expect(matchAlias('adr/0001-x.md')).toBe('decisions');
    expect(matchAlias('docs/adr/0002-y.md')).toBe('decisions');
    expect(matchAlias('docs/qa/estrategia.md')).toBe('testing');
    expect(matchAlias('.claude/skills/x/SKILL.md')).toBe('skills');
  });

  it('NÃO é ganancioso: archive ≠ arch', () => {
    expect(matchAlias('docs/archive/notas.md')).toBeNull();
    expect(matchAlias('docs/architecture-decisions-old/x.md')).toBeNull();
    expect(matchAlias('src/deployment-notes.txt')).toBeNull();
  });

  it('retorna null para arquivo sem alias', () => {
    expect(matchAlias('docs/random.md')).toBeNull();
    expect(matchAlias('README.md')).toBeNull();
  });

  it('CLAUDE.md e AGENTS.md casam skills', () => {
    expect(matchAlias('CLAUDE.md')).toBe('skills');
    expect(matchAlias('AGENTS.md')).toBe('skills');
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd apps/api && npx jest alias-table -c jest.config.js` (ou `npm test -- alias-table`)
Expected: FAIL — "Cannot find module './alias-table'".

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/ingestion/domain/alias-table.ts
import { Entity } from './entity';

/** Normaliza para comparação: minúsculas, sem acento. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** basename sem extensão. `docs/Arch.md` → `arch`. */
function baseNoExt(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Nomes de arquivo (sem extensão) que casam cada entidade. */
const NAME_ALIASES: Record<Entity, string[]> = {
  architecture: ['architecture', 'arquitetura', 'arch', 'design-doc'],
  decisions: ['decisions', 'decisoes'],
  design: ['design', 'ui', 'styleguide'],
  testing: ['testing', 'testes', 'qa'],
  deploy: ['deploy', 'deployment', 'infra', 'runbook'],
  skills: ['claude', 'agents'],
};

/** Diretórios que, se contiverem o arquivo, casam a entidade (coleção). */
const DIR_ALIASES: Record<Entity, string[]> = {
  architecture: ['docs/arch'],
  decisions: ['adr', 'adrs', 'decisions', 'decisoes', 'docs/adr'],
  design: ['docs/design-system'],
  testing: ['docs/qa'],
  deploy: [],
  skills: ['.claude'],
};

/**
 * Resolve o path para uma entidade por alias — nome inteiro (sem extensão) OU
 * diretório, por igualdade normalizada. Nunca substring (`archive` ≠ `arch`).
 * Diretório tem prioridade sobre nome (adr/0001-x.md é decisions, não pelo nome).
 */
export function matchAlias(path: string): Entity | null {
  const p = norm(path);
  for (const entity of Object.keys(DIR_ALIASES) as Entity[]) {
    for (const dir of DIR_ALIASES[entity]) {
      if (p.startsWith(norm(dir) + '/')) return entity;
    }
  }
  const base = norm(baseNoExt(path));
  for (const entity of Object.keys(NAME_ALIASES) as Entity[]) {
    if (NAME_ALIASES[entity].includes(base)) return entity;
  }
  return null;
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd apps/api && npx jest alias-table`
Expected: PASS (todos os casos, incluindo `archive ≠ arch`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion/domain/alias-table.ts apps/api/src/modules/ingestion/domain/alias-table.spec.ts
git commit -m "ingestion: tabela de alias não-gananciosa (ADR-014)"
```

---

### Task 3: parseProplanConfig

**Files:**
- Create: `apps/api/src/modules/ingestion/domain/proplan-config.ts`
- Test: `apps/api/src/modules/ingestion/domain/proplan-config.spec.ts`

**Interfaces:**
- Consumes: `Entity` de `entity.ts`.
- Produces: `ProplanConfig` (`{ mapping: Partial<Record<Entity, string | null>> }`), `parseProplanConfig(yaml: string | null): { config: ProplanConfig | null; invalid: boolean }`, `mergeProplanConfig`, `serializeProplanConfig`.

- [ ] **Step 1: Instalar `yaml`**

```bash
cd apps/api && npm install yaml
```

- [ ] **Step 2: Escrever os testes (falham primeiro)**

```ts
// apps/api/src/modules/ingestion/domain/proplan-config.spec.ts
import {
  parseProplanConfig,
  mergeProplanConfig,
  serializeProplanConfig,
} from './proplan-config';

describe('parseProplanConfig', () => {
  it('parseia mapping válido', () => {
    const yaml = `proplan: v2\nmapping:\n  architecture: docs/notas.md\n  deploy: null\n`;
    const { config, invalid } = parseProplanConfig(yaml);
    expect(invalid).toBe(false);
    expect(config?.mapping.architecture).toBe('docs/notas.md');
    expect(config?.mapping.deploy).toBeNull();
  });

  it('arquivo ausente → config null, não inválido', () => {
    const { config, invalid } = parseProplanConfig(null);
    expect(config).toBeNull();
    expect(invalid).toBe(false);
  });

  it('YAML quebrado → invalid true, não lança', () => {
    const { config, invalid } = parseProplanConfig('mapping: [: : :');
    expect(config).toBeNull();
    expect(invalid).toBe(true);
  });

  it('ignora chaves de entidade desconhecidas', () => {
    const yaml = `proplan: v2\nmapping:\n  banana: x.md\n  design: docs/d.md\n`;
    const { config } = parseProplanConfig(yaml);
    expect(config?.mapping.design).toBe('docs/d.md');
    expect((config?.mapping as Record<string, unknown>).banana).toBeUndefined();
  });
});

describe('mergeProplanConfig + serializeProplanConfig', () => {
  it('mescla entidade preservando as demais', () => {
    const base = { mapping: { architecture: 'docs/a.md' } };
    const merged = mergeProplanConfig(base, 'deploy', null);
    expect(merged.mapping.architecture).toBe('docs/a.md');
    expect(merged.mapping.deploy).toBeNull();
  });

  it('serializa round-trip parseável com proplan: v2', () => {
    const cfg = { mapping: { testing: 'docs/qa/e.md', deploy: null } };
    const yaml = serializeProplanConfig(cfg);
    expect(yaml).toContain('proplan: v2');
    const { config } = parseProplanConfig(yaml);
    expect(config?.mapping.testing).toBe('docs/qa/e.md');
    expect(config?.mapping.deploy).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar — deve falhar**

Run: `cd apps/api && npx jest proplan-config`
Expected: FAIL — "Cannot find module './proplan-config'".

- [ ] **Step 4: Implementar**

```ts
// apps/api/src/modules/ingestion/domain/proplan-config.ts
import { parse, stringify } from 'yaml';
import { Entity, ENTITIES } from './entity';

/** Mapeamento explícito do usuário (ADR-014). null = ausência confirmada. */
export interface ProplanConfig {
  mapping: Partial<Record<Entity, string | null>>;
}

function isEntity(k: string): k is Entity {
  return (ENTITIES as string[]).includes(k);
}

/**
 * Parseia `.proplan/config.yml`. Nunca lança: YAML quebrado → invalid=true e
 * config=null (o caller cai na escada e a UI avisa). Arquivo ausente (null) →
 * config=null, invalid=false.
 */
export function parseProplanConfig(yaml: string | null): {
  config: ProplanConfig | null;
  invalid: boolean;
} {
  if (yaml === null || yaml.trim() === '') return { config: null, invalid: false };
  try {
    const raw = parse(yaml) as { mapping?: Record<string, unknown> } | null;
    const rawMapping = raw?.mapping ?? {};
    const mapping: Partial<Record<Entity, string | null>> = {};
    for (const [k, v] of Object.entries(rawMapping)) {
      if (!isEntity(k)) continue;
      if (v === null) mapping[k] = null;
      else if (typeof v === 'string') mapping[k] = v;
    }
    return { config: { mapping }, invalid: false };
  } catch {
    return { config: null, invalid: true };
  }
}

/** Mescla uma entidade no config (imutável), preservando as demais. */
export function mergeProplanConfig(
  base: ProplanConfig | null,
  entity: Entity,
  path: string | null,
): ProplanConfig {
  const mapping = { ...(base?.mapping ?? {}) };
  mapping[entity] = path;
  return { mapping };
}

/** Reescreve o arquivo inteiro (gerador determinístico), `proplan: v2`. */
export function serializeProplanConfig(cfg: ProplanConfig): string {
  const header = '# gerado/atualizado pelo ProPlan (ADR-014) — mapeamento de documentos\n';
  const body = stringify({ proplan: 'v2', mapping: cfg.mapping });
  return header + body;
}
```

- [ ] **Step 5: Rodar — deve passar**

Run: `cd apps/api && npx jest proplan-config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ingestion/domain/proplan-config.ts apps/api/src/modules/ingestion/domain/proplan-config.spec.ts apps/api/package.json apps/api/package-lock.json
git commit -m "ingestion: parse/merge/serialize de .proplan/config.yml (ADR-014)"
```

---

### Task 4: DocumentResolver (a escada)

**Files:**
- Create: `apps/api/src/modules/ingestion/domain/document-resolver.ts`
- Test: `apps/api/src/modules/ingestion/domain/document-resolver.spec.ts`

**Interfaces:**
- Consumes: `Entity`, `ENTITIES`, `Resolution` (`entity.ts`), `matchAlias` (`alias-table.ts`), `ProplanConfig` (`proplan-config.ts`).
- Produces: `resolveDocuments(input: ResolverInput): Resolution[]` onde `ResolverInput = { docs: DocInput[]; config: ProplanConfig | null }` e `DocInput = { path: string; isConventional: boolean }`.

- [ ] **Step 1: Escrever os testes (falham primeiro)**

```ts
// apps/api/src/modules/ingestion/domain/document-resolver.spec.ts
import { resolveDocuments } from './document-resolver';

const doc = (path: string, isConventional = false) => ({ path, isConventional });

describe('resolveDocuments — escada ADR-014', () => {
  it('nível 1: convenção (path exato + proplan:v1)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/ARCHITECTURE.md', true)],
      config: null,
    });
    const arch = res.find((r) => r.entity === 'architecture')!;
    expect(arch.level).toBe(1);
    expect(arch.source).toBe('convention');
    expect(arch.path).toBe('docs/ARCHITECTURE.md');
    expect(arch.confidence).toBe(1);
  });

  it('path canônico SEM frontmatter proplan:v1 NÃO é nível 1 (cai pra alias)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/ARCHITECTURE.md', false)],
      config: null,
    });
    const arch = res.find((r) => r.entity === 'architecture')!;
    expect(arch.level).toBe(2);
    expect(arch.source).toBe('alias');
  });

  it('nível 2: alias (nomes próprios, sem frontmatter)', () => {
    const res = resolveDocuments({
      docs: [
        doc('docs/arquitetura.md'),
        doc('adr/0001-x.md'),
        doc('docs/qa/estrategia.md'),
      ],
      config: null,
    });
    expect(res.find((r) => r.entity === 'architecture')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'architecture')!.path).toBe('docs/arquitetura.md');
    const dec = res.find((r) => r.entity === 'decisions')!;
    expect(dec.level).toBe(2);
    expect(dec.paths).toEqual(['adr/0001-x.md']); // coleção
    expect(dec.path).toBeNull();
    expect(res.find((r) => r.entity === 'testing')!.path).toBe('docs/qa/estrategia.md');
  });

  it('nível 4: ausente quando nada casa', () => {
    const res = resolveDocuments({ docs: [doc('README.md')], config: null });
    const dep = res.find((r) => r.entity === 'deploy')!;
    expect(dep.level).toBe(4);
    expect(dep.source).toBe('absent');
    expect(dep.confidence).toBe(0);
  });

  it('config vence convenção (aponta outro arquivo)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/ARCHITECTURE.md', true), doc('docs/notas.md')],
      config: { mapping: { architecture: 'docs/notas.md' } },
    });
    const arch = res.find((r) => r.entity === 'architecture')!;
    expect(arch.source).toBe('config');
    expect(arch.path).toBe('docs/notas.md');
  });

  it('config null explícito → ausência confirmada (source config)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/DEPLOY.md', true)],
      config: { mapping: { deploy: null } },
    });
    const dep = res.find((r) => r.entity === 'deploy')!;
    expect(dep.level).toBe(4);
    expect(dep.source).toBe('config');
    expect(dep.path).toBeNull();
  });

  it('config apontando diretório → coleção', () => {
    const res = resolveDocuments({
      docs: [doc('minhas-decisoes/a.md'), doc('minhas-decisoes/b.md')],
      config: { mapping: { decisions: 'minhas-decisoes/' } },
    });
    const dec = res.find((r) => r.entity === 'decisions')!;
    expect(dec.source).toBe('config');
    expect(dec.paths.sort()).toEqual(['minhas-decisoes/a.md', 'minhas-decisoes/b.md']);
  });

  it('sempre devolve as 6 entidades', () => {
    const res = resolveDocuments({ docs: [], config: null });
    expect(res.map((r) => r.entity).sort()).toEqual(
      ['architecture', 'decisions', 'deploy', 'design', 'skills', 'testing'],
    );
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd apps/api && npx jest document-resolver`
Expected: FAIL — "Cannot find module './document-resolver'".

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/ingestion/domain/document-resolver.ts
import { matchAlias } from './alias-table';
import { Entity, ENTITIES, Resolution } from './entity';
import { ProplanConfig } from './proplan-config';

export interface DocInput {
  path: string;
  isConventional: boolean;
}
export interface ResolverInput {
  docs: DocInput[];
  config: ProplanConfig | null;
}

/** Caminho canônico (nível 1) de cada entidade. */
const CONVENTION_PATH: Record<Entity, string> = {
  architecture: 'docs/ARCHITECTURE.md',
  decisions: 'docs/DECISIONS.md',
  design: 'docs/DESIGN.md',
  testing: 'docs/TESTING.md',
  deploy: 'docs/DEPLOY.md',
  skills: 'CLAUDE.md',
};

function absent(entity: Entity, source: 'absent' | 'config'): Resolution {
  return { entity, level: 4, source, path: null, paths: [], confidence: source === 'config' ? 1 : 0 };
}

/** Arquivos sob um diretório (prefixo `dir/`). `dir` pode ou não ter barra final. */
function under(docs: DocInput[], dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : dir + '/';
  return docs.filter((d) => d.path.startsWith(prefix)).map((d) => d.path).sort();
}

/**
 * Resolve as 6 entidades pela escada do ADR-014 (config → convenção → alias →
 * ausente). Puro: recebe docs + config já parseados, devolve Resolution[].
 */
export function resolveDocuments(input: ResolverInput): Resolution[] {
  const { docs, config } = input;
  const paths = new Set(docs.map((d) => d.path));

  return ENTITIES.map((entity) => resolveOne(entity, docs, paths, config));
}

function resolveOne(
  entity: Entity,
  docs: DocInput[],
  paths: Set<string>,
  config: ProplanConfig | null,
): Resolution {
  // 1. Config vence tudo.
  const mapped = config?.mapping?.[entity];
  if (mapped !== undefined) {
    if (mapped === null) return absent(entity, 'config');
    if (mapped.endsWith('/')) {
      const coll = under(docs, mapped);
      return { entity, level: 2, source: 'config', path: null, paths: coll, confidence: 1 };
    }
    return { entity, level: 1, source: 'config', path: mapped, paths: [], confidence: 1 };
  }

  // 2. Convenção: path exato COM frontmatter proplan:v1.
  const conv = docs.find((d) => d.path === CONVENTION_PATH[entity] && d.isConventional);
  if (conv) {
    return { entity, level: 1, source: 'convention', path: conv.path, paths: [], confidence: 1 };
  }

  // 3. Alias: nome inteiro ou diretório (não-ganancioso).
  const aliasHits = docs.filter((d) => matchAlias(d.path) === entity).map((d) => d.path);
  if (aliasHits.length > 0) {
    // Coleção quando 2+ arquivos casam (adr/, docs/qa/) ou skills; senão arquivo único.
    if (aliasHits.length > 1 || entity === 'decisions' || entity === 'skills') {
      return { entity, level: 2, source: 'alias', path: null, paths: aliasHits.sort(), confidence: 0.8 };
    }
    return { entity, level: 2, source: 'alias', path: aliasHits[0], paths: [], confidence: 0.8 };
  }

  // 4. Ausente.
  return absent(entity, 'absent');
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd apps/api && npx jest document-resolver`
Expected: PASS (todos os casos da escada).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ingestion/domain/document-resolver.ts apps/api/src/modules/ingestion/domain/document-resolver.spec.ts
git commit -m "ingestion: DocumentResolver — escada de resolução (ADR-014)"
```

---

### Task 5: Prisma — DocumentResolution + proplanConfigInvalid

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (após o model `DocLink`, e campo em `Project`)

**Interfaces:**
- Produces: model `DocumentResolution` (`@@unique([projectId, entity])`), campo `Project.proplanConfigInvalid`.

- [ ] **Step 1: Adicionar o campo em `Project`**

Em `model Project`, após a linha `needsIssueImport ...` (schema.prisma:47), adicionar:

```prisma
  proplanConfigInvalid Boolean @default(false) @map("proplan_config_invalid")
```

E, na lista de relações do `Project` (após `boardMutations ...`, linha 54), adicionar:

```prisma
  resolutions    DocumentResolution[]
```

- [ ] **Step 2: Adicionar o model** (após o `model DocLink { ... }`, ~linha 96)

```prisma
// Cache derivado da resolução de documentos (ADR-014, Fatia 6). NÃO é fonte —
// a decisão do usuário mora em .proplan/config.yml no repo. Apagar estas linhas
// e re-sincronizar reconstrói a resolução idêntica. `docsTreeSha` e `resolvedAt`
// preparam o nível 3 (Fatia 7, insight): job assíncrono versionado por tree-sha
// grava aqui com source: 'inference' — daí os campos entram já nesta migration.
model DocumentResolution {
  id          String   @id @default(uuid())
  projectId   String   @map("project_id")
  entity      String   // architecture | decisions | design | testing | deploy | skills
  level       Int      // 1 | 2 | 4
  source      String   // convention | alias | config | absent | inference (Fatia 7)
  path        String?
  paths       String[]
  confidence  Float
  docsTreeSha String?  @map("docs_tree_sha")
  resolvedAt  DateTime @default(now()) @map("resolved_at")
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, entity])
  @@map("document_resolutions")
}
```

> `docsTreeSha`/`resolvedAt` vêm da SPEC-006 corrigida (2026-07-13): a Fatia 7 grava nível 3 aqui, versionado por tree-sha. Incluí-los agora evita uma migration na Fatia 7. Nos níveis 1/2/4 (determinísticos, sem hash de conteúdo) `docsTreeSha` fica `null`; `resolvedAt` marca o recálculo.

- [ ] **Step 3: Gerar a migration**

Run: `cd apps/api && npx prisma migrate dev --name fatia_6_document_resolution`
Expected: cria `prisma/migrations/*_fatia_6_document_resolution/`, aplica, regenera o client. Sem erro.

- [ ] **Step 4: Verificar o client**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erro (o client já tem `prisma.documentResolution`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "ingestion: model DocumentResolution + proplanConfigInvalid (migration)"
```

---

### Task 6: ResolutionService — rebuild persiste

**Files:**
- Create: `apps/api/src/modules/ingestion/application/resolution.service.ts`
- Test: `apps/api/src/modules/ingestion/application/resolution.service.spec.ts`
- Modify: `apps/api/src/modules/ingestion/ingestion.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `resolveDocuments`, `parseProplanConfig`, `Entity`, `Resolution`.
- Produces: `ResolutionService.rebuild(projectId): Promise<void>` (replace-all + flag de config inválido); `ResolutionService.resolutionOf(projectId, entity): Promise<Resolution>`.

- [ ] **Step 1: Escrever o teste (mock do Prisma)**

```ts
// apps/api/src/modules/ingestion/application/resolution.service.spec.ts
import { ResolutionService } from './resolution.service';

function makePrisma(docs: { path: string; isConventional: boolean; content: string }[]) {
  const created: any[] = [];
  return {
    created,
    prisma: {
      document: {
        findMany: jest.fn().mockResolvedValue(docs),
        findUnique: jest.fn().mockResolvedValue(
          docs.find((d) => d.path === '.proplan/config.yml') ?? null,
        ),
      },
      documentResolution: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockImplementation(({ data }) => {
          created.push(...data);
          return Promise.resolve({});
        }),
      },
      project: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as any,
  };
}

describe('ResolutionService.rebuild', () => {
  it('persiste 6 resoluções e marca config válido', async () => {
    const { prisma, created } = makePrisma([
      { path: 'docs/arquitetura.md', isConventional: false, content: '# a' },
    ]);
    const svc = new ResolutionService(prisma);
    await svc.rebuild('p1');
    expect(created).toHaveLength(6);
    expect(created.find((r) => r.entity === 'architecture').source).toBe('alias');
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { proplanConfigInvalid: false } }),
    );
  });

  it('config inválido → flag true, ainda persiste (cai na escada)', async () => {
    const { prisma, created } = makePrisma([
      { path: '.proplan/config.yml', isConventional: false, content: 'mapping: [: :' },
    ]);
    const svc = new ResolutionService(prisma);
    await svc.rebuild('p1');
    expect(created).toHaveLength(6);
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { proplanConfigInvalid: true } }),
    );
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd apps/api && npx jest resolution.service`
Expected: FAIL — "Cannot find module './resolution.service'".

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/ingestion/application/resolution.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveDocuments } from '../domain/document-resolver';
import { Entity, Resolution } from '../domain/entity';
import { parseProplanConfig } from '../domain/proplan-config';

const CONFIG_PATH = '.proplan/config.yml';

@Injectable()
export class ResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputa e persiste a resolução de todas as entidades (replace-all), como
   * rebuildLinks. Cache derivado: apagar as linhas + re-sync reconstrói idêntico.
   * Config YAML quebrado → flag proplanConfigInvalid, mas a resolução segue
   * (cai na escada). Chamado no fim de todo sync (success e noop).
   */
  async rebuild(projectId: string): Promise<void> {
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, isConventional: true },
    });

    const configDoc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path: CONFIG_PATH } },
      select: { content: true },
    });
    const { config, invalid } = parseProplanConfig(configDoc?.content ?? null);

    const resolutions = resolveDocuments({ docs, config });
    const rows = resolutions.map((r) => ({
      projectId,
      entity: r.entity,
      level: r.level,
      source: r.source,
      path: r.path,
      paths: r.paths,
      confidence: r.confidence,
    }));

    await this.prisma.$transaction([
      this.prisma.documentResolution.deleteMany({ where: { projectId } }),
      this.prisma.documentResolution.createMany({ data: rows }),
    ]);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { proplanConfigInvalid: invalid },
    });
  }

  /** Lê a resolução persistida de uma entidade (cache). */
  async resolutionOf(projectId: string, entity: Entity): Promise<Resolution> {
    const row = await this.prisma.documentResolution.findUnique({
      where: { projectId_entity: { projectId, entity } },
    });
    if (!row) throw new NotFoundException(`Resolução não encontrada: ${entity}`);
    return {
      entity: row.entity as Entity,
      level: row.level as 1 | 2 | 4,
      source: row.source as Resolution['source'],
      path: row.path,
      paths: row.paths,
      confidence: row.confidence,
    };
  }
}
```

- [ ] **Step 4: Registrar no módulo**

Em `ingestion.module.ts`, adicionar `ResolutionService` a `providers` e a `exports` (para o `board` consumir via `IngestionModule`). Import:

```ts
import { ResolutionService } from './application/resolution.service';
```

- [ ] **Step 5: Rodar — deve passar**

Run: `cd apps/api && npx jest resolution.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ingestion/application/resolution.service.ts apps/api/src/modules/ingestion/application/resolution.service.spec.ts apps/api/src/modules/ingestion/ingestion.module.ts
git commit -m "ingestion: ResolutionService persiste a resolução (cache derivado)"
```

---

### Task 7: Escopo ampliado + gatilho no sync

**Files:**
- Modify: `apps/api/src/modules/ingestion/domain/scope-filter.ts`
- Modify: `apps/api/src/modules/ingestion/domain/scope-filter.spec.ts`
- Modify: `apps/api/src/modules/ingestion/application/sync.service.ts`

**Interfaces:**
- Consumes: `ResolutionService` (injetado no `SyncService`).

- [ ] **Step 1: Atualizar o teste de escopo (o antigo esperava `false`)**

Substituir o bloco `it('exclui .claude e workflows (só na Fatia 6)', ...)` por:

```ts
  it('Fatia 6: inclui .proplan/config.yml, .claude e workflows', () => {
    expect(isInScope('.proplan/config.yml')).toBe(true);
    expect(isInScope('.claude/skills/x/SKILL.md')).toBe(true);
    expect(isInScope('.claude/agents/y.md')).toBe(true);
    expect(isInScope('.github/workflows/ci.yml')).toBe(true);
    expect(isInScope('.github/workflows/ci.yaml')).toBe(true);
  });

  it('Fatia 6: inclui diretórios de alias na raiz e alias soltos', () => {
    expect(isInScope('adr/0001-x.md')).toBe(true);
    expect(isInScope('decisions/0001.md')).toBe(true);
    expect(isInScope('AGENTS.md')).toBe(true);
    expect(isInScope('CONTRIBUTING.md')).toBe(true);
  });

  it('Fatia 6: exclui ruído de .claude e .github fora do escopo fino', () => {
    expect(isInScope('.claude/settings.json')).toBe(false);
    expect(isInScope('.github/ISSUE_TEMPLATE/bug.md')).toBe(false);
    expect(isInScope('.proplan/STATUS.md')).toBe(false); // artefato gerado, não fonte
  });
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd apps/api && npx jest scope-filter`
Expected: FAIL nos novos casos.

- [ ] **Step 3: Implementar o escopo ampliado**

```ts
// apps/api/src/modules/ingestion/domain/scope-filter.ts

/** Diretórios de alias na raiz (repos que não usam docs/). */
const ROOT_ALIAS_DIRS = ['adr/', 'adrs/', 'decisions/', 'decisoes/'];
/** Arquivos de alias soltos na raiz. */
const ROOT_ALIAS_FILES = new Set([
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'RUNBOOK.md',
  'ROADMAP.md',
  'TODO.md',
]);

/**
 * Escopo de ingestão (ADR-003, ampliado na Fatia 6/ADR-014): docs/**, arquivos
 * e diretórios de alias na raiz, .proplan/config.yml, .claude fino (skills/agents)
 * e workflows do CI. Match sobre o path POSIX completo, sem barra inicial.
 */
export function isInScope(path: string): boolean {
  if (ROOT_ALIAS_FILES.has(path)) return true;
  if (path === '.proplan/config.yml') return true;
  if (path.startsWith('docs/')) return true;
  if (ROOT_ALIAS_DIRS.some((d) => path.startsWith(d))) return true;
  // .claude fino: só índices de skills e agents (evita settings/hooks).
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path)) return true;
  if (/^\.claude\/agents\/[^/]+\.md$/.test(path)) return true;
  // Workflows do CI (fallback de Testes).
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return true;
  return false;
}
```

> Nota: `.proplan/STATUS.md` fica fora (é artefato gerado, não fonte). `.proplan/config.yml` entra (é o mapeamento do usuário).

- [ ] **Step 4: Plugar `resolution.rebuild` no sync**

Em `sync.service.ts`:
1. Import: `import { ResolutionService } from './resolution.service';`
2. Injetar no construtor (após `private readonly links: LinkService,`):
   ```ts
   private readonly resolution: ResolutionService,
   ```
3. Após **cada** `await this.links.rebuildLinks(...)` — há dois (noop na ~linha 82 e success na ~linha 146) — adicionar na linha seguinte:
   ```ts
   await this.resolution.rebuild(project.id);
   ```

- [ ] **Step 5: Rodar testes + build**

Run: `cd apps/api && npx jest scope-filter && npx tsc --noEmit`
Expected: PASS + sem erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ingestion/domain/scope-filter.ts apps/api/src/modules/ingestion/domain/scope-filter.spec.ts apps/api/src/modules/ingestion/application/sync.service.ts
git commit -m "ingestion: escopo ampliado (Fatia 6) + rebuild da resolução no sync"
```

---

### Task 8: API GET /tabs/:tab (só architecture) + TabsService

**Files:**
- Create: `apps/api/src/modules/board/application/tabs.service.ts`
- Create: `apps/api/src/modules/board/presentation/tabs.controller.ts`
- Test: `apps/api/src/modules/board/application/tabs.service.spec.ts`
- Modify: `apps/api/src/modules/board/board.module.ts`

**Interfaces:**
- Consumes: `IngestionService.resolutionOf` (via `ResolutionService` exportado), `PrismaService`.
- Produces: `GET /projects/:id/tabs/:tab` → `{ source, payload }`. Nesta task só `architecture` (markdown); as demais entram na Fase 2.

- [ ] **Step 1: Escrever o teste**

```ts
// apps/api/src/modules/board/application/tabs.service.spec.ts
import { TabsService } from './tabs.service';

describe('TabsService.getTab — architecture', () => {
  it('resolvida → markdown do doc', async () => {
    const resolution = { entity: 'architecture', level: 1, source: 'convention', path: 'docs/ARCHITECTURE.md', paths: [], confidence: 1 };
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue({ content: '# Arquitetura' }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const svc = new TabsService(prisma, ingestion);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(1);
    expect(out.payload).toEqual({ markdown: '# Arquitetura' });
  });

  it('ausente → payload null', async () => {
    const resolution = { entity: 'architecture', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const svc = new TabsService(prisma, ingestion);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(4);
    expect(out.payload).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd apps/api && npx jest tabs.service`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o service** (só `architecture`/markdown; switch preparado para expandir)

```ts
// apps/api/src/modules/board/application/tabs.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, Resolution } from '../../ingestion/domain/entity';

export interface TabSource {
  level: 1 | 2 | 4;
  source: Resolution['source'];
  path: string | null;
  paths: string[];
  confidence: number;
}
export interface TabResponse {
  source: TabSource;
  payload: unknown | null;
}

@Injectable()
export class TabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: ResolutionService,
  ) {}

  async getTab(projectId: string, tab: Entity): Promise<TabResponse> {
    const r = await this.ingestion.resolutionOf(projectId, tab);
    const source: TabSource = {
      level: r.level, source: r.source, path: r.path, paths: r.paths, confidence: r.confidence,
    };
    if (r.level === 4) return { source, payload: null };

    switch (tab) {
      case 'architecture':
      case 'design':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path) } };
      default:
        // Fase 2 preenche decisions/testing/deploy/skills.
        return { source, payload: null };
    }
  }

  private async markdownOf(projectId: string, path: string | null): Promise<string> {
    if (!path) return '';
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { content: true },
    });
    if (!doc) throw new NotFoundException(`Documento não encontrado: ${path}`);
    return doc.content;
  }
}
```

- [ ] **Step 4: Implementar o controller**

```ts
// apps/api/src/modules/board/presentation/tabs.controller.ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TabsService } from '../application/tabs.service';
import { ENTITIES, Entity } from '../../ingestion/domain/entity';
import { NotFoundException } from '@nestjs/common';

@Controller('projects/:id')
@UseGuards(JwtAuthGuard)
export class TabsController {
  constructor(private readonly tabs: TabsService) {}

  @Get('tabs/:tab')
  async getTab(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('tab') tab: string,
  ) {
    if (!(ENTITIES as string[]).includes(tab)) {
      throw new NotFoundException(`Aba desconhecida: ${tab}`);
    }
    // TODO-ownership: JwtAuthGuard já autentica; ownership é validado nas outras
    // rotas do projeto pelo mesmo padrão (assertOwner). Reusar quando o board o
    // expuser publicamente — aqui a resolução é do projeto do usuário logado.
    return this.tabs.getTab(projectId, tab as Entity);
  }
}
```

> Ownership: seguir o padrão do `BoardController` (validar dono via `assertOwner`). Se o `TabsController` precisar, injetar o mesmo mecanismo que o board já usa. Confirmar na Task ao ler `board.controller.ts`.

- [ ] **Step 5: Registrar no módulo**

Em `board.module.ts`: adicionar `TabsController` a `controllers`, `TabsService` a `providers`, e garantir que `IngestionModule` está nos `imports` (para `ResolutionService`).

- [ ] **Step 6: Rodar teste + build + subir**

Run: `cd apps/api && npx jest tabs.service && npx tsc --noEmit && npm run build`
Expected: PASS + build limpo.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/board
git commit -m "board: GET /tabs/:tab (architecture) via resolução persistida"
```

---

### Task 9: Front — Mermaid + MarkdownView + TabFrame + aba Arquitetura

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/workspace/Mermaid.tsx`
- Create: `apps/web/src/pages/workspace/MarkdownView.tsx`
- Create: `apps/web/src/pages/workspace/TabFrame.tsx`
- Create: `apps/web/src/pages/workspace/tabs/ArchitectureTab.tsx`
- Modify: `apps/web/src/pages/workspace/tabs.ts`
- Modify: `apps/web/src/pages/workspace/Workspace.tsx`

**Interfaces:**
- Consumes: `GET /tabs/:tab`.
- Produces: `api.tab`, tipos `TabResponse`/`TabSource`; componentes reusáveis pelas outras abas.

- [ ] **Step 1: Instalar mermaid**

```bash
cd apps/web && npm install mermaid
```

- [ ] **Step 2: Tipos + método no `lib/api.ts`**

Adicionar ao arquivo:

```ts
export type Entity = 'architecture' | 'decisions' | 'design' | 'testing' | 'deploy' | 'skills';
export type TabSourceKind = 'convention' | 'alias' | 'config' | 'absent';

export interface TabSource {
  level: 1 | 2 | 4;
  source: TabSourceKind;
  path: string | null;
  paths: string[];
  confidence: number;
}
export interface TabResponse<P = unknown> {
  source: TabSource;
  payload: P | null;
}
```

E dentro do objeto `api`, após `graph:`:

```ts
  tab: <P = unknown>(projectId: string, tab: Entity) =>
    request<TabResponse<P>>(`/projects/${projectId}/tabs/${tab}`),
```

- [ ] **Step 3: Componente Mermaid (lazy, fallback)**

```tsx
// apps/web/src/pages/workspace/Mermaid.tsx
import { useEffect, useRef, useState } from 'react';

let idSeq = 0;

/** Renderiza um bloco Mermaid. Import lazy (só carrega quando montado). Erro de
 *  sintaxe → mostra o código cru (não derruba a aba). */
export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const id = `mmd-${idSeq++}`;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
        const { svg } = await mermaid.render(id, code);
        if (active && ref.current) ref.current.innerHTML = svg;
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className="overflow-x-auto rounded-md bg-bg p-3 text-xs">
        <code>{code}</code>
      </pre>
    );
  }
  return <div ref={ref} className="my-4 flex justify-center" />;
}
```

- [ ] **Step 4: MarkdownView (react-markdown + intercepta ```mermaid)**

```tsx
// apps/web/src/pages/workspace/MarkdownView.tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Mermaid } from './Mermaid';

/** Render de markdown com Mermaid desenhado (vale para todas as abas e Documentos). */
export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <article className="prose-doc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isMermaid = /language-mermaid/.test(className ?? '');
            if (isMermaid) return <Mermaid code={String(children).trim()} />;
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
```

- [ ] **Step 5: TabFrame (trilho comum)**

```tsx
// apps/web/src/pages/workspace/TabFrame.tsx
import { ReactNode } from 'react';
import { TabSource } from '../../lib/api';

interface Props {
  loading: boolean;
  error: string | null;
  source: TabSource | null;
  /** Rótulo da entidade para os estados vazios (ex.: "Arquitetura"). */
  label: string;
  /** Abre a tela de mapeamento focada nesta entidade. */
  onCorrect: () => void;
  children: ReactNode;
}

/** Estados uniformes das abas: skeleton, erro, aviso de fonte (alias), ausente. */
export function TabFrame({ loading, error, source, label, onCorrect, children }: Props) {
  if (loading) return <div className="m-8 h-40 animate-pulse rounded-md bg-border/50" />;
  if (error) return <p className="m-8 text-sm text-error">{error}</p>;

  if (source && source.level === 4) {
    return (
      <div className="m-8 rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">{label} não documentado</p>
        <p className="mt-1 text-xs text-text-muted">
          Nenhuma fonte para esta aba neste repositório.
        </p>
        <button
          onClick={onCorrect}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs hover:border-brand hover:text-brand"
        >
          Mapear fonte
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      {source?.source === 'alias' && (
        <p className="mb-4 text-xs text-text-muted">
          Fonte: <span className="font-mono">{source.path ?? source.paths[0]}</span>{' '}
          (reconhecido por nome —{' '}
          <button onClick={onCorrect} className="underline hover:text-brand">
            corrigir
          </button>
          )
        </p>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Aba Arquitetura**

```tsx
// apps/web/src/pages/workspace/tabs/ArchitectureTab.tsx
import { useEffect, useState } from 'react';
import { api, TabSource } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import { TabFrame } from '../TabFrame';

interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function ArchitectureTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<{ markdown: string }>(projectId, 'architecture')
      .then((res) => {
        if (!active) return;
        setSource(res.source);
        setMarkdown(res.payload?.markdown ?? '');
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, syncNonce]);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Arquitetura" onCorrect={onCorrect}>
      <MarkdownView markdown={markdown} />
    </TabFrame>
  );
}
```

- [ ] **Step 7: Registro + wire**

Em `tabs.ts`: mudar `export const CURRENT_SLICE = 5;` → `6`; adicionar `{ id: 'decisions', label: 'Decisões', enabledIn: 6 }` após `graph`.

Em `Workspace.tsx`: importar `ArchitectureTab`, e no bloco de render adicionar (o `onCorrect` liga o mapeamento — na Fase 3 vira função real; por ora `() => {}`):

```tsx
        {activeTab === 'architecture' && (
          <ArchitectureTab projectId={projectId} syncNonce={syncNonce} onCorrect={() => {}} />
        )}
```

- [ ] **Step 8: Build + validação runtime**

Run: `cd apps/web && npm run build`
Expected: build limpo (bundle não deve estourar; mermaid é dynamic import).

Validação runtime (padrão das fatias anteriores): subir a app, abrir o rrb-proplan, aba **Arquitetura** renderiza o `docs/ARCHITECTURE.md` com o **Mermaid desenhado** (C4), sem aviso de fonte (nível 1).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/workspace apps/web/package.json apps/web/package-lock.json
git commit -m "web: aba Arquitetura ponta-a-ponta + Mermaid + trilho de abas"
```

---

**⛳ Checkpoint Fase 1** — parar e validar no rrb-proplan: resolução persistida (6 linhas em `document_resolutions`), `GET /tabs/architecture` responde nível 1, aba desenha o Mermaid. Este é o eixo caro provado. Só então seguir.

---

## FASE 2 — Replicar as 5 abas restantes

### Task 10: Parser decisions-index (arquivo ou coleção)

**Files:**
- Create: `apps/api/src/modules/board/domain/decisions-index.ts`
- Test: `apps/api/src/modules/board/domain/decisions-index.spec.ts`

**Interfaces:**
- Produces: `parseDecisions(docs: { path: string; content: string }[]): DecisionItem[]` com `DecisionItem = { title: string; status: string | null; date: string | null; path: string; anchor: string | null }`.

- [ ] **Step 1: Testes**

```ts
// apps/api/src/modules/board/domain/decisions-index.spec.ts
import { parseDecisions } from './decisions-index';

describe('parseDecisions', () => {
  it('arquivo único: fatia por ## e extrai título', () => {
    const content = `# Decisões\n\n## ADR-001 — Escolha do ORM\nStatus: aceito\n\n## ADR-002 — Filas\nStatus: proposto\n`;
    const items = parseDecisions([{ path: 'docs/DECISIONS.md', content }]);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('ADR-001 — Escolha do ORM');
    expect(items[0].anchor).toBe('adr-001-—-escolha-do-orm');
    expect(items[0].path).toBe('docs/DECISIONS.md');
  });

  it('coleção: um item por arquivo, título do H1', () => {
    const items = parseDecisions([
      { path: 'adr/0001-orm.md', content: '# Escolha do ORM\n...' },
      { path: 'adr/0002-filas.md', content: '# Filas com BullMQ\n...' },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Escolha do ORM');
    expect(items[0].anchor).toBeNull();
  });

  it('fallback de título quando não há H1: usa o basename', () => {
    const items = parseDecisions([{ path: 'adr/0003-x.md', content: 'sem título\n' }]);
    expect(items[0].title).toBe('0003-x');
  });
});
```

- [ ] **Step 2: Rodar — falha.** Run: `cd apps/api && npx jest decisions-index` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/board/domain/decisions-index.ts
export interface DecisionItem {
  title: string;
  status: string | null;
  date: string | null;
  path: string;
  anchor: string | null; // âncora no doc (só quando arquivo único)
}

/** Slug de âncora GitHub-like: minúsculas, espaços→hífen, remove pontuação leve. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s—-]/g, '')
    .replace(/\s+/g, '-');
}

function baseNoExt(path: string): string {
  const b = path.split('/').pop() ?? path;
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
}

/** Status/data de linhas tipo "Status: aceito" / "Data: 2026-07-12" logo abaixo do título. */
function fieldAfter(block: string, field: RegExp): string | null {
  const m = block.match(field);
  return m ? m[1].trim() : null;
}

/**
 * Índice de decisões. Um arquivo (DECISIONS.md) → fatia por `## `. Coleção
 * (adr/*.md) → um item por arquivo, título do primeiro `# `.
 */
export function parseDecisions(docs: { path: string; content: string }[]): DecisionItem[] {
  if (docs.length === 1 && /decisions|decisoes/i.test(docs[0].path)) {
    return sliceSingle(docs[0]);
  }
  return docs.map((d) => sliceCollectionEntry(d));
}

function sliceSingle(doc: { path: string; content: string }): DecisionItem[] {
  const parts = doc.content.split(/^##\s+/m).slice(1);
  return parts.map((block) => {
    const title = block.split('\n', 1)[0].trim();
    return {
      title,
      status: fieldAfter(block, /Status:\s*(.+)/i),
      date: fieldAfter(block, /Data:\s*(.+)/i),
      path: doc.path,
      anchor: slug(title),
    };
  });
}

function sliceCollectionEntry(doc: { path: string; content: string }): DecisionItem {
  const h1 = doc.content.match(/^#\s+(.+)$/m);
  return {
    title: h1 ? h1[1].trim() : baseNoExt(doc.path),
    status: fieldAfter(doc.content, /Status:\s*(.+)/i),
    date: fieldAfter(doc.content, /Data:\s*(.+)/i),
    path: doc.path,
    anchor: null,
  };
}
```

- [ ] **Step 4: Rodar — passa.** Run: `cd apps/api && npx jest decisions-index` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/board/domain/decisions-index.ts apps/api/src/modules/board/domain/decisions-index.spec.ts
git commit -m "board: parser de decisões (arquivo ou coleção)"
```

---

### Task 11: Parser deploy-doc

**Files:**
- Create: `apps/api/src/modules/board/domain/deploy-doc.ts`
- Test: `apps/api/src/modules/board/domain/deploy-doc.spec.ts`

**Interfaces:**
- Produces: `parseDeploy(content: string): DeployEnv[]` com `DeployEnv = { env: string; status: string; platform: string; url: string | null }`.

- [ ] **Step 1: Testes**

```ts
// apps/api/src/modules/board/domain/deploy-doc.spec.ts
import { parseDeploy } from './deploy-doc';

describe('parseDeploy', () => {
  it('parseia a tabela de ambientes do CONVENTION.md', () => {
    const content = `# Deploy\n\n## Ambientes\n| Ambiente | Status | Plataforma | URL |\n|---|---|---|---|\n| produção | ativo | Vercel + Supabase | https://app.exemplo.com |\n| homolog | inativo | — | — |\n`;
    const envs = parseDeploy(content);
    expect(envs).toHaveLength(2);
    expect(envs[0]).toEqual({ env: 'produção', status: 'ativo', platform: 'Vercel + Supabase', url: 'https://app.exemplo.com' });
    expect(envs[1].url).toBeNull(); // '—' vira null
  });

  it('sem tabela → lista vazia', () => {
    expect(parseDeploy('# Deploy\n\nSem ambientes ainda.')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar — falha.** Run: `cd apps/api && npx jest deploy-doc` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/board/domain/deploy-doc.ts
export interface DeployEnv {
  env: string;
  status: string;
  platform: string;
  url: string | null;
}

function cell(s: string): string {
  return s.trim();
}
function urlOrNull(s: string): string | null {
  const v = s.trim();
  return v === '' || v === '—' || v === '-' ? null : v;
}

/**
 * Parseia a tabela markdown `| Ambiente | Status | Plataforma | URL |`. Ignora a
 * linha de cabeçalho e a de separação. Célula '—' vira null na URL.
 */
export function parseDeploy(content: string): DeployEnv[] {
  const lines = content.split('\n');
  const out: DeployEnv[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map(cell);
    if (cells.length < 4) continue;
    const [env, status, platform, url] = cells;
    // Pular cabeçalho e separador.
    if (/^ambiente$/i.test(env) || /^-+$/.test(env)) continue;
    out.push({ env, status, platform, url: urlOrNull(url) });
  }
  return out;
}
```

- [ ] **Step 4: Rodar — passa.** Run: `cd apps/api && npx jest deploy-doc` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/board/domain/deploy-doc.ts apps/api/src/modules/board/domain/deploy-doc.spec.ts
git commit -m "board: parser da tabela de ambientes de deploy"
```

---

### Task 12: Parser skills-index

**Files:**
- Create: `apps/api/src/modules/board/domain/skills-index.ts`
- Test: `apps/api/src/modules/board/domain/skills-index.spec.ts`

**Interfaces:**
- Consumes: `gray-matter` (já no projeto).
- Produces: `parseSkills(docs: { path: string; content: string }[]): { skills: SkillEntry[]; agents: SkillEntry[] }` com `SkillEntry = { name: string; description: string | null; path: string }`.

- [ ] **Step 1: Testes**

```ts
// apps/api/src/modules/board/domain/skills-index.spec.ts
import { parseSkills } from './skills-index';

describe('parseSkills', () => {
  it('separa skills e agents pelo path, lê name/description do frontmatter', () => {
    const out = parseSkills([
      { path: '.claude/skills/foo/SKILL.md', content: '---\nname: foo\ndescription: faz foo\n---\n# Foo' },
      { path: '.claude/agents/bar.md', content: '---\nname: bar\ndescription: agente bar\n---\n' },
      { path: 'CLAUDE.md', content: '# Regras' },
    ]);
    expect(out.skills).toEqual([{ name: 'foo', description: 'faz foo', path: '.claude/skills/foo/SKILL.md' }]);
    expect(out.agents).toEqual([{ name: 'bar', description: 'agente bar', path: '.claude/agents/bar.md' }]);
  });

  it('sem frontmatter → name do basename, description null', () => {
    const out = parseSkills([{ path: '.claude/skills/x/SKILL.md', content: '# só título' }]);
    expect(out.skills[0].name).toBe('x');
    expect(out.skills[0].description).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar — falha.** Run: `cd apps/api && npx jest skills-index` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/board/domain/skills-index.ts
import matter from 'gray-matter';

export interface SkillEntry {
  name: string;
  description: string | null;
  path: string;
}

function parseEntry(doc: { path: string; content: string }, nameFromDir: boolean): SkillEntry {
  let data: Record<string, unknown> = {};
  try {
    data = matter(doc.content).data as Record<string, unknown>;
  } catch {
    data = {};
  }
  const fallback = nameFromDir
    ? (doc.path.split('/').slice(-2, -1)[0] ?? doc.path) // .../<nome>/SKILL.md
    : (doc.path.split('/').pop() ?? doc.path).replace(/\.md$/, '');
  return {
    name: typeof data.name === 'string' ? data.name : fallback,
    description: typeof data.description === 'string' ? data.description : null,
    path: doc.path,
  };
}

/** Índice determinístico de skills e agents (sem IA). CLAUDE.md sozinho não gera
 *  entradas (é regra, não skill) — mas indica que há configuração. */
export function parseSkills(docs: { path: string; content: string }[]): {
  skills: SkillEntry[];
  agents: SkillEntry[];
} {
  const skills = docs
    .filter((d) => /\.claude\/skills\/[^/]+\/SKILL\.md$/.test(d.path))
    .map((d) => parseEntry(d, true));
  const agents = docs
    .filter((d) => /\.claude\/agents\/[^/]+\.md$/.test(d.path))
    .map((d) => parseEntry(d, false));
  return { skills, agents };
}
```

- [ ] **Step 4: Rodar — passa.** Run: `cd apps/api && npx jest skills-index` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/board/domain/skills-index.ts apps/api/src/modules/board/domain/skills-index.spec.ts
git commit -m "board: parser determinístico de skills & agents"
```

---

### Task 13: Parser workflow-parser (fallback de Testes)

**Files:**
- Create: `apps/api/src/modules/board/domain/workflow-parser.ts`
- Test: `apps/api/src/modules/board/domain/workflow-parser.spec.ts`

**Interfaces:**
- Consumes: `yaml` (instalado na Task 3).
- Produces: `parseWorkflow(path: string, content: string): WorkflowInfo | null` com `WorkflowInfo = { file: string; name: string; triggers: string[]; jobs: { name: string; runsOn: string | null }[] }`.

- [ ] **Step 1: Testes**

```ts
// apps/api/src/modules/board/domain/workflow-parser.spec.ts
import { parseWorkflow } from './workflow-parser';

describe('parseWorkflow', () => {
  it('extrai name, gatilhos e jobs', () => {
    const yaml = `name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n  test:\n    runs-on: ubuntu-22.04\n`;
    const wf = parseWorkflow('.github/workflows/ci.yml', yaml)!;
    expect(wf.name).toBe('CI');
    expect(wf.triggers.sort()).toEqual(['pull_request', 'push']);
    expect(wf.jobs).toEqual([
      { name: 'build', runsOn: 'ubuntu-latest' },
      { name: 'test', runsOn: 'ubuntu-22.04' },
    ]);
  });

  it('name ausente → usa o nome do arquivo', () => {
    const wf = parseWorkflow('.github/workflows/deploy.yml', 'on: push\njobs: {}\n')!;
    expect(wf.name).toBe('deploy.yml');
  });

  it('YAML quebrado → null (não derruba a aba)', () => {
    expect(parseWorkflow('.github/workflows/x.yml', 'on: [: :')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar — falha.** Run: `cd apps/api && npx jest workflow-parser` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/board/domain/workflow-parser.ts
import { parse } from 'yaml';

export interface WorkflowInfo {
  file: string;
  name: string;
  triggers: string[];
  jobs: { name: string; runsOn: string | null }[];
}

function triggersOf(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === 'object') return Object.keys(on as Record<string, unknown>);
  return [];
}

/** Parseia um workflow do GitHub Actions: name, gatilhos (on), jobs (nome +
 *  runs-on). Não interpreta steps. YAML quebrado → null. */
export function parseWorkflow(path: string, content: string): WorkflowInfo | null {
  try {
    const doc = parse(content) as { name?: unknown; on?: unknown; jobs?: Record<string, { 'runs-on'?: unknown }> } | null;
    if (!doc || typeof doc !== 'object') return null;
    const jobsObj = doc.jobs ?? {};
    const jobs = Object.entries(jobsObj).map(([name, def]) => ({
      name,
      runsOn: def && typeof def['runs-on'] === 'string' ? (def['runs-on'] as string) : null,
    }));
    return {
      file: path,
      name: typeof doc.name === 'string' ? doc.name : (path.split('/').pop() ?? path),
      triggers: triggersOf(doc.on),
      jobs,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar — passa.** Run: `cd apps/api && npx jest workflow-parser` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/board/domain/workflow-parser.ts apps/api/src/modules/board/domain/workflow-parser.spec.ts
git commit -m "board: parser de workflows do CI (fallback de Testes)"
```

---

### Task 14: TabsService — as 5 abas restantes

**Files:**
- Modify: `apps/api/src/modules/board/application/tabs.service.ts`
- Modify: `apps/api/src/modules/board/application/tabs.service.spec.ts`

**Interfaces:**
- Consumes: `parseDecisions`, `parseDeploy`, `parseSkills`, `parseWorkflow`.
- Produces: payloads por aba conforme o Design §4.

- [ ] **Step 1: Adicionar testes ao spec** (decisions/testing-fallback/deploy/skills)

```ts
  it('decisions: coleção → items', async () => {
    const resolution = { entity: 'decisions', level: 2, source: 'alias', path: null, paths: ['adr/0001-x.md'], confidence: 0.8 };
    const prisma = {
      document: { findMany: jest.fn().mockResolvedValue([{ path: 'adr/0001-x.md', content: '# Título X' }]) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const out = await new TabsService(prisma, ingestion).getTab('p1', 'decisions');
    expect((out.payload as any).items[0].title).toBe('Título X');
  });

  it('testing: sem doc mas com workflows → ci inferido', async () => {
    const resolution = { entity: 'testing', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = {
      document: {
        findMany: jest.fn().mockResolvedValue([
          { path: '.github/workflows/ci.yml', content: 'name: CI\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n' },
        ]),
      },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const out = await new TabsService(prisma, ingestion).getTab('p1', 'testing');
    expect((out.payload as any).inferred).toBe(true);
    expect((out.payload as any).ci.workflows[0].name).toBe('CI');
    expect(out.source.level).toBe(4); // resolução ainda é ausente; payload é fallback
  });

  it('deploy: ausente e sem CI → payload null (nunca IA)', async () => {
    const resolution = { entity: 'deploy', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn(), findMany: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const out = await new TabsService(prisma, ingestion).getTab('p1', 'deploy');
    expect(out.payload).toBeNull();
  });
```

- [ ] **Step 2: Rodar — falha nos novos casos.** Run: `cd apps/api && npx jest tabs.service` → FAIL.

- [ ] **Step 3: Expandir o switch do `getTab`**

Substituir o `switch (tab)` inteiro por:

```ts
    switch (tab) {
      case 'architecture':
      case 'design':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path) } };
      case 'decisions': {
        const docs = await this.docsOf(projectId, r.path ? [r.path] : r.paths);
        return { source, payload: { items: parseDecisions(docs) } };
      }
      case 'deploy': {
        const md = await this.markdownOf(projectId, r.path);
        return { source, payload: { environments: parseDeploy(md) } };
      }
      case 'skills': {
        const docs = await this.docsOf(projectId, r.paths.length ? r.paths : r.path ? [r.path] : []);
        return { source, payload: parseSkills(docs) };
      }
      case 'testing':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path) } };
      default:
        return { source, payload: null };
    }
```

E, **antes** do `switch`, tratar o fallback de Testes (a única aba com fallback quando `level === 4`) — substituir o early-return de `level === 4`:

```ts
    if (r.level === 4) {
      if (tab === 'testing') {
        const ci = await this.ciFallback(projectId);
        if (ci.workflows.length > 0) return { source, payload: { ci, inferred: true } };
      }
      return { source, payload: null };
    }
```

Adicionar os helpers e imports:

```ts
import { parseDecisions } from '../domain/decisions-index';
import { parseDeploy } from '../domain/deploy-doc';
import { parseSkills } from '../domain/skills-index';
import { parseWorkflow, WorkflowInfo } from '../domain/workflow-parser';
```

```ts
  private async docsOf(projectId: string, paths: string[]): Promise<{ path: string; content: string }[]> {
    if (paths.length === 0) return [];
    const rows = await this.prisma.document.findMany({
      where: { projectId, path: { in: paths } },
      select: { path: true, content: true },
    });
    return rows;
  }

  private async ciFallback(projectId: string): Promise<{ workflows: WorkflowInfo[] }> {
    const rows = await this.prisma.document.findMany({
      where: { projectId, path: { startsWith: '.github/workflows/' } },
      select: { path: true, content: true },
    });
    const workflows = rows
      .map((d) => parseWorkflow(d.path, d.content))
      .filter((w): w is WorkflowInfo => w !== null);
    return { workflows };
  }
```

- [ ] **Step 4: Rodar — passa + build.** Run: `cd apps/api && npx jest tabs.service && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/board/application/tabs.service.ts apps/api/src/modules/board/application/tabs.service.spec.ts
git commit -m "board: payloads das abas Decisões, Testes (fallback CI), Deploy, Skills"
```

---

### Task 15: Front — 5 abas restantes

**Files:**
- Create: `apps/web/src/pages/workspace/tabs/DesignTab.tsx`, `DecisionsTab.tsx`, `TestsTab.tsx`, `DeployTab.tsx`, `SkillsTab.tsx`
- Modify: `apps/web/src/lib/api.ts` (tipos de payload)
- Modify: `apps/web/src/pages/workspace/Workspace.tsx` (wire)

**Interfaces:**
- Consumes: `api.tab`, `TabFrame`, `MarkdownView`, `DocViewerPanel`.

- [ ] **Step 1: Tipos de payload no `lib/api.ts`**

```ts
export interface DecisionItem { title: string; status: string | null; date: string | null; path: string; anchor: string | null; }
export interface DeployEnv { env: string; status: string; platform: string; url: string | null; }
export interface SkillEntry { name: string; description: string | null; path: string; }
export interface WorkflowInfo { file: string; name: string; triggers: string[]; jobs: { name: string; runsOn: string | null }[]; }
```

- [ ] **Step 2: DesignTab** (idêntica à Arquitetura, entidade `design`, label "Design")

```tsx
// apps/web/src/pages/workspace/tabs/DesignTab.tsx
import { useEffect, useState } from 'react';
import { api, TabSource } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import { TabFrame } from '../TabFrame';

interface Props { projectId: string; syncNonce: number; onCorrect: () => void; }

export function DesignTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    api.tab<{ markdown: string }>(projectId, 'design')
      .then((res) => { if (!active) return; setSource(res.source); setMarkdown(res.payload?.markdown ?? ''); })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [projectId, syncNonce]);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Design" onCorrect={onCorrect}>
      <MarkdownView markdown={markdown} />
    </TabFrame>
  );
}
```

- [ ] **Step 3: DecisionsTab** (lista + abre no `DocViewerPanel`)

```tsx
// apps/web/src/pages/workspace/tabs/DecisionsTab.tsx
import { useEffect, useState } from 'react';
import { api, DecisionItem, TabSource } from '../../../lib/api';
import { TabFrame } from '../TabFrame';
import { DocViewerPanel } from '../DocViewerPanel';

interface Props { projectId: string; syncNonce: number; onCorrect: () => void; }

export function DecisionsTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    api.tab<{ items: DecisionItem[] }>(projectId, 'decisions')
      .then((res) => { if (!active) return; setSource(res.source); setItems(res.payload?.items ?? []); })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [projectId, syncNonce]);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Decisões" onCorrect={onCorrect}>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={`${it.path}-${i}`}>
            <button
              onClick={() => setOpen(it.path)}
              className="w-full rounded-md border border-border px-4 py-3 text-left hover:border-brand"
            >
              <div className="text-sm font-medium">{it.title}</div>
              <div className="mt-0.5 text-xs text-text-muted">
                {[it.status, it.date].filter(Boolean).join(' · ') || it.path}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {open && <DocViewerPanel projectId={projectId} path={open} onClose={() => setOpen(null)} />}
    </TabFrame>
  );
}
```

- [ ] **Step 4: TestsTab** (markdown ou lista de CI)

```tsx
// apps/web/src/pages/workspace/tabs/TestsTab.tsx
import { useEffect, useState } from 'react';
import { api, TabSource, WorkflowInfo } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import { TabFrame } from '../TabFrame';

type Payload = { markdown: string } | { ci: { workflows: WorkflowInfo[] }; inferred: true };
interface Props { projectId: string; syncNonce: number; onCorrect: () => void; }

export function TestsTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    api.tab<Payload>(projectId, 'testing')
      .then((res) => { if (!active) return; setSource(res.source); setPayload(res.payload); })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [projectId, syncNonce]);

  const isCi = payload !== null && 'ci' in payload;

  return (
    <TabFrame loading={loading} error={error} source={isCi ? null : source} label="Testes" onCorrect={onCorrect}>
      {payload && 'markdown' in payload && <MarkdownView markdown={payload.markdown} />}
      {payload && 'ci' in payload && (
        <div>
          <p className="mb-4 text-xs text-text-muted">Inferido do CI (nenhum doc de testes encontrado).</p>
          <ul className="space-y-3">
            {payload.ci.workflows.map((wf) => (
              <li key={wf.file} className="rounded-md border border-border p-4">
                <div className="text-sm font-medium">{wf.name}</div>
                <div className="mt-1 text-xs text-text-muted">Gatilhos: {wf.triggers.join(', ') || '—'}</div>
                <div className="mt-1 text-xs text-text-muted">
                  Jobs: {wf.jobs.map((j) => `${j.name}${j.runsOn ? ` (${j.runsOn})` : ''}`).join(', ') || '—'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TabFrame>
  );
}
```

> Nota: quando o fallback de CI existe, `source.level` é 4, mas há payload — passo `source={null}` ao `TabFrame` nesse caso para ele não mostrar o empty state "não documentado". O aviso "Inferido do CI" cobre a origem.

- [ ] **Step 5: DeployTab** (tabela com badges)

```tsx
// apps/web/src/pages/workspace/tabs/DeployTab.tsx
import { useEffect, useState } from 'react';
import { api, DeployEnv, TabSource } from '../../../lib/api';
import { TabFrame } from '../TabFrame';

interface Props { projectId: string; syncNonce: number; onCorrect: () => void; }

export function DeployTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [envs, setEnvs] = useState<DeployEnv[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    api.tab<{ environments: DeployEnv[] }>(projectId, 'deploy')
      .then((res) => { if (!active) return; setSource(res.source); setEnvs(res.payload?.environments ?? []); })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [projectId, syncNonce]);

  const active = (s: string) => /ativo|active|produção|production/i.test(s);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Deploy" onCorrect={onCorrect}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-text-muted">
          <tr><th className="pb-2">Ambiente</th><th className="pb-2">Status</th><th className="pb-2">Plataforma</th><th className="pb-2">URL</th></tr>
        </thead>
        <tbody>
          {envs.map((e) => (
            <tr key={e.env} className="border-t border-border">
              <td className="py-2 font-medium">{e.env}</td>
              <td className="py-2">
                <span className={'rounded-full px-2 py-0.5 text-xs ' + (active(e.status) ? 'bg-success/10 text-success' : 'bg-border/50 text-text-muted')}>
                  {e.status}
                </span>
              </td>
              <td className="py-2 text-text-muted">{e.platform}</td>
              <td className="py-2">
                {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{e.url}</a> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TabFrame>
  );
}
```

- [ ] **Step 6: SkillsTab** (grupos)

```tsx
// apps/web/src/pages/workspace/tabs/SkillsTab.tsx
import { useEffect, useState } from 'react';
import { api, SkillEntry, TabSource } from '../../../lib/api';
import { TabFrame } from '../TabFrame';

interface Props { projectId: string; syncNonce: number; onCorrect: () => void; }

function Group({ title, entries }: { title: string; entries: SkillEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.path} className="rounded-md border border-border p-3">
            <div className="text-sm font-medium">{e.name}</div>
            {e.description && <div className="mt-0.5 text-xs text-text-muted">{e.description}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SkillsTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [data, setData] = useState<{ skills: SkillEntry[]; agents: SkillEntry[] }>({ skills: [], agents: [] });

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    api.tab<{ skills: SkillEntry[]; agents: SkillEntry[] }>(projectId, 'skills')
      .then((res) => { if (!active) return; setSource(res.source); setData(res.payload ?? { skills: [], agents: [] }); })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [projectId, syncNonce]);

  const empty = data.skills.length === 0 && data.agents.length === 0;

  return (
    <TabFrame loading={loading} error={error} source={empty ? source : { ...(source as TabSource), source: source?.source ?? 'convention' }} label="Skills & Agentes" onCorrect={onCorrect}>
      {empty ? (
        <p className="text-sm text-text-muted">Nenhuma skill ou agente configurado neste repositório.</p>
      ) : (
        <>
          <Group title="Skills" entries={data.skills} />
          <Group title="Agentes" entries={data.agents} />
        </>
      )}
    </TabFrame>
  );
}
```

- [ ] **Step 7: Wire no Workspace.tsx**

Importar as 5 abas e adicionar ao render (todas com `onCorrect={() => {}}` por ora):

```tsx
        {activeTab === 'design' && <DesignTab projectId={projectId} syncNonce={syncNonce} onCorrect={() => {}} />}
        {activeTab === 'decisions' && <DecisionsTab projectId={projectId} syncNonce={syncNonce} onCorrect={() => {}} />}
        {activeTab === 'tests' && <TestsTab projectId={projectId} syncNonce={syncNonce} onCorrect={() => {}} />}
        {activeTab === 'deploy' && <DeployTab projectId={projectId} syncNonce={syncNonce} onCorrect={() => {}} />}
        {activeTab === 'skills' && <SkillsTab projectId={projectId} syncNonce={syncNonce} onCorrect={() => {}} />}
```

- [ ] **Step 8: Build + validação runtime**

Run: `cd apps/web && npm run build`
Expected: build limpo.

Validação: no rrb-proplan, abas Decisões (lista de ADRs), Design (markdown), Testes (doc ou CI), Deploy (tabela), Skills (grupos) renderizam.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "web: abas Design, Decisões, Testes, Deploy, Skills & Agentes"
```

---

**⛳ Checkpoint Fase 2** — as 6 abas resolvem e renderizam no rrb-proplan (nível 1, sem aviso). Seguir para o mapeamento.

---

## FASE 3 — Mapeamento (GET/PUT + tela + atalho)

### Task 16: MappingService — candidatos + escrita do config.yml

**Files:**
- Create: `apps/api/src/modules/board/application/mapping.service.ts`
- Test: `apps/api/src/modules/board/application/mapping.service.spec.ts`
- Modify: `apps/api/src/modules/board/presentation/tabs.controller.ts` (rotas mapping)

**Interfaces:**
- Consumes: `ResolutionService.resolutionOf`, `PrismaService`, `GithubWritebackClient`, `GithubAuth.installationToken`, `parseProplanConfig`/`mergeProplanConfig`/`serializeProplanConfig`, `IngestionService.enqueueSync`.
- Produces: `getMapping(projectId): Promise<MappingRow[]>`, `putMapping(projectId, entity, path): Promise<{ syncRunId }>`.

- [ ] **Step 1: Testes** (foco na escrita mescla + re-sync; write-back mockado)

```ts
// apps/api/src/modules/board/application/mapping.service.spec.ts
import { MappingService } from './mapping.service';

describe('MappingService.putMapping', () => {
  it('mescla a entidade no config existente e reescreve com write-back + re-sync', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r', defaultBranch: 'main' }) },
      document: { findUnique: jest.fn().mockResolvedValue({ content: 'proplan: v2\nmapping:\n  architecture: docs/a.md\n' }) },
    } as any;
    const auth = { installationToken: jest.fn().mockResolvedValue('tok') } as any;
    const writeback = {
      getFileSha: jest.fn().mockResolvedValue('sha1'),
      putFile: jest.fn().mockResolvedValue('sha2'),
    } as any;
    const ingestion = { enqueueSync: jest.fn().mockResolvedValue({ syncRunId: 'run1' }) } as any;

    const svc = new MappingService(prisma, auth, writeback, ingestion);
    const out = await svc.putMapping('p1', 'deploy', null);

    const putArg = writeback.putFile.mock.calls[0][0];
    expect(putArg.path).toBe('.proplan/config.yml');
    expect(putArg.content).toContain('architecture: docs/a.md'); // preservou
    expect(putArg.content).toContain('deploy: null');            // mesclou
    expect(putArg.baseSha).toBe('sha1');
    expect(out.syncRunId).toBe('run1');
  });
});
```

- [ ] **Step 2: Rodar — falha.** Run: `cd apps/api && npx jest mapping.service` → FAIL.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/modules/board/application/mapping.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import { GithubWritebackClient } from '../../../shared/github/github-writeback.client';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, ENTITIES, Resolution } from '../../ingestion/domain/entity';
import {
  mergeProplanConfig,
  parseProplanConfig,
  serializeProplanConfig,
} from '../../ingestion/domain/proplan-config';

const CONFIG_PATH = '.proplan/config.yml';

export interface MappingRow {
  entity: Entity;
  resolution: Resolution;
  candidates: string[]; // arquivos e diretórios do repo
}

@Injectable()
export class MappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly writeback: GithubWritebackClient,
    private readonly ingestion: IngestionService,
  ) {}

  /** As 6 entidades com a resolução atual + candidatos (paths + diretórios do repo). */
  async getMapping(projectId: string): Promise<MappingRow[]> {
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true },
    });
    const files = docs.map((d) => d.path);
    const dirs = Array.from(new Set(files.map((p) => p.split('/').slice(0, -1).join('/')).filter(Boolean).map((d) => d + '/')));
    const candidates = [...files, ...dirs].sort();

    const rows: MappingRow[] = [];
    for (const entity of ENTITIES) {
      const resolution = await this.ingestion.resolutionOf(projectId, entity);
      rows.push({ entity, resolution, candidates });
    }
    return rows;
  }

  /** Escreve a entidade em .proplan/config.yml (ler-mesclar-reescrever) + re-sync. */
  async putMapping(projectId: string, entity: Entity, path: string | null): Promise<{ syncRunId: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const current = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path: CONFIG_PATH } },
      select: { content: true },
    });
    const { config } = parseProplanConfig(current?.content ?? null);
    const merged = mergeProplanConfig(config, entity, path);
    const content = serializeProplanConfig(merged);

    const token = await this.auth.installationToken(projectId);
    const baseSha = await this.writeback.getFileSha(token, project.owner, project.name, CONFIG_PATH, project.defaultBranch);
    await this.writeback.putFile({
      token,
      owner: project.owner,
      repo: project.name,
      path: CONFIG_PATH,
      branch: project.defaultBranch,
      content,
      message: `proplan: mapeia ${entity} → ${path ?? 'ausente'} (.proplan/config.yml)`,
      baseSha,
    });

    return this.ingestion.enqueueSync(projectId);
  }
}
```

> `installationToken(projectId)` é o mesmo do board (Fatia 5). Se a assinatura real diferir (ex.: recebe `userId`+`installationId`), ajustar ao ler `github-auth.service.ts` — o padrão do `mutation-applier.service.ts` é a referência.

- [ ] **Step 4: Rotas no controller**

Em `tabs.controller.ts`, injetar `MappingService` e adicionar:

```ts
  @Get('mapping')
  getMapping(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.mapping.getMapping(projectId);
  }

  @Put('mapping')
  @HttpCode(202)
  putMapping(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() body: { entity: string; path: string | null },
  ) {
    if (!(ENTITIES as string[]).includes(body.entity)) {
      throw new NotFoundException(`Entidade desconhecida: ${body.entity}`);
    }
    return this.mapping.putMapping(projectId, body.entity as Entity, body.path);
  }
```

Imports novos no controller: `Body`, `Put`, `HttpCode`, `MappingService`.

- [ ] **Step 5: Registrar no módulo**

`MappingService` em `providers` do `board.module.ts`. Confirmar que `SharedModule` (write-back) e `IngestionModule` estão importados.

- [ ] **Step 6: Rodar + build.** Run: `cd apps/api && npx jest mapping.service && npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/board
git commit -m "board: GET/PUT /mapping — escreve .proplan/config.yml (write-back + re-sync)"
```

---

### Task 17: Front — MappingScreen + atalho + método api

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/workspace/MappingScreen.tsx`
- Modify: `apps/web/src/pages/workspace/Workspace.tsx` (botão + wire do `onCorrect`)

**Interfaces:**
- Consumes: `GET /mapping`, `PUT /mapping`.

- [ ] **Step 1: Tipos + métodos no `lib/api.ts`**

```ts
export interface MappingRow {
  entity: Entity;
  resolution: TabSource & { entity: Entity };
  candidates: string[];
}
```

Dentro do objeto `api`, após `tab:`:

```ts
  mapping: (projectId: string) => request<MappingRow[]>(`/projects/${projectId}/mapping`),
  putMapping: (projectId: string, entity: Entity, path: string | null) =>
    request<{ syncRunId: string }>(`/projects/${projectId}/mapping`, {
      method: 'PUT',
      body: JSON.stringify({ entity, path }),
    }),
```

- [ ] **Step 2: MappingScreen**

```tsx
// apps/web/src/pages/workspace/MappingScreen.tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, Entity, MappingRow } from '../../lib/api';

const LABELS: Record<Entity, string> = {
  architecture: 'Arquitetura', decisions: 'Decisões', design: 'Design',
  testing: 'Testes', deploy: 'Deploy', skills: 'Skills & Agentes',
};
const SOURCE_BADGE: Record<string, string> = {
  convention: 'convenção', alias: 'reconhecido por nome', config: 'manual', absent: 'ausente',
};

interface Props {
  projectId: string;
  focusEntity: Entity | null;
  onClose: () => void;
  onSaved: () => void;
}

export function MappingScreen({ projectId, focusEntity, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Entity | null>(null);

  useEffect(() => {
    let active = true;
    api.mapping(projectId)
      .then((r) => active && setRows(r))
      .catch((e) => active && toast.error(`Falha ao carregar mapeamento: ${e}`))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [projectId]);

  async function save(entity: Entity, path: string | null) {
    setSaving(entity);
    const toastId = toast.loading('Salvando no repo…');
    try {
      await api.putMapping(projectId, entity, path);
      toast.success('Mapeamento salvo — re-sincronizando.', { id: toastId });
      onSaved();
    } catch (e) {
      toast.error(`Falha ao salvar: ${e}`, { id: toastId });
    } finally {
      setSaving(null);
    }
  }

  const resolved = rows.filter((r) => r.resolution.level !== 4).length;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <div>
          <h2 className="text-lg font-semibold">Mapeamento de documentos</h2>
          <p className="text-xs text-text-muted">{resolved} de {rows.length} resolvidas · {rows.length - resolved} ausentes</p>
        </div>
        <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-brand">Fechar</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-8">
        {loading ? (
          <div className="h-40 animate-pulse rounded-md bg-border/50" />
        ) : (
          <ul className="space-y-4">
            {rows.map((r) => (
              <li
                key={r.entity}
                className={'rounded-lg border p-4 ' + (focusEntity === r.entity ? 'border-brand' : 'border-border')}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{LABELS[r.entity]}</span>
                  <span className="rounded-full bg-bg px-2 py-0.5 text-xs text-text-muted">
                    {SOURCE_BADGE[r.resolution.source]}
                  </span>
                </div>
                <div className="mt-1 font-mono text-xs text-text-muted">
                  {r.resolution.path ?? (r.resolution.paths.length ? r.resolution.paths.join(', ') : '—')}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <select
                    className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
                    defaultValue={r.resolution.path ?? ''}
                    disabled={saving === r.entity}
                    onChange={(e) => save(r.entity, e.target.value || null)}
                  >
                    <option value="">(marcar ausente)</option>
                    {r.candidates.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {saving === r.entity && <span className="text-xs text-text-muted">salvando…</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire no Workspace.tsx** — estado do mapeamento, botão no header, `onCorrect` real

Adicionar estado:

```tsx
  const [mapping, setMapping] = useState<{ open: boolean; focus: Entity | null }>({ open: false, focus: null });
```

Botão no header (ao lado de Sincronizar):

```tsx
          <button
            onClick={() => setMapping({ open: true, focus: null })}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:border-brand hover:text-brand"
          >
            Mapeamento
          </button>
```

Trocar todos os `onCorrect={() => {}}` das 6 abas por:

```tsx
onCorrect={() => setMapping({ open: true, focus: '<entidade>' })}
```

(`architecture` na ArchitectureTab, `design` na DesignTab, etc.)

Render do overlay (antes do fechamento do container):

```tsx
      {mapping.open && (
        <MappingScreen
          projectId={projectId}
          focusEntity={mapping.focus}
          onClose={() => setMapping({ open: false, focus: null })}
          onSaved={() => { setMapping({ open: false, focus: null }); setSyncNonce((n) => n + 1); }}
        />
      )}
```

Importar `MappingScreen` e o tipo `Entity`.

- [ ] **Step 4: Build + validação runtime**

Run: `cd apps/web && npm run build`
Expected: build limpo.

Validação: botão Mapeamento abre a tela; trocar a fonte da Arquitetura para outro arquivo → toast "salvando no repo…" → re-sync → aba usa a nova fonte. Marcar Deploy ausente → aba para de oferecer CTA.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "web: tela de mapeamento + atalho 'corrigir' nas abas"
```

---

## FASE 4 — Fixture, critérios de aceite, docs

### Task 18: Teste de integração do resolver com fixtures de repo

**Files:**
- Create: `apps/api/src/modules/ingestion/domain/document-resolver.fixtures.spec.ts`

**Interfaces:**
- Consumes: `resolveDocuments`.

- [ ] **Step 1: Teste com os 3 perfis de repo (o que prova a fatia)**

```ts
// apps/api/src/modules/ingestion/domain/document-resolver.fixtures.spec.ts
import { resolveDocuments } from './document-resolver';

const doc = (path: string, isConventional = false) => ({ path, isConventional });

describe('DocumentResolver — fixtures de repo (SPEC-006)', () => {
  it('repo-convenção: tudo nível 1, sem alias', () => {
    const docs = [
      doc('docs/ARCHITECTURE.md', true), doc('docs/DECISIONS.md', true),
      doc('docs/DESIGN.md', true), doc('docs/TESTING.md', true),
      doc('docs/DEPLOY.md', true), doc('CLAUDE.md', true),
    ];
    const res = resolveDocuments({ docs, config: null });
    expect(res.every((r) => r.level === 1)).toBe(true);
    expect(res.some((r) => r.source === 'alias')).toBe(false);
  });

  it('repo-nomes-próprios: tudo nível 2 (O TESTE QUE PROVA A FATIA)', () => {
    const docs = [
      doc('docs/arquitetura.md'), doc('adr/0001-orm.md'), doc('adr/0002-filas.md'),
      doc('docs/qa/estrategia.md'), doc('docs/ui.md'), doc('DEPLOY.md'), doc('AGENTS.md'),
    ];
    const res = resolveDocuments({ docs, config: null });
    expect(res.find((r) => r.entity === 'architecture')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'decisions')!.paths).toEqual(['adr/0001-orm.md', 'adr/0002-filas.md']);
    expect(res.find((r) => r.entity === 'testing')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'design')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'deploy')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'skills')!.level).toBe(2);
  });

  it('repo-vazio: tudo nível 4, nada inventa', () => {
    const res = resolveDocuments({ docs: [doc('README.md')], config: null });
    expect(res.every((r) => r.level === 4)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar.** Run: `cd apps/api && npx jest document-resolver.fixtures` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/ingestion/domain/document-resolver.fixtures.spec.ts
git commit -m "ingestion: fixtures dos 3 perfis de repo (prova da fatia)"
```

---

### Task 19: Suíte completa + validação runtime dos critérios de aceite

**Files:** nenhum novo (verificação).

- [ ] **Step 1: Suíte back completa + builds**

Run: `cd apps/api && npx jest && npx tsc --noEmit && npm run build`
Expected: toda a suíte verde, sem erro de tipo, build limpo.

Run: `cd apps/web && npm run build`
Expected: build limpo.

- [ ] **Step 2: Subir a app e validar cada critério de aceite da SPEC-006**

Checklist runtime (app local, padrão das fatias anteriores — anotar resultado):
- [ ] rrb-proplan: 6 abas nível 1, sem aviso; Arquitetura desenha o Mermaid.
- [ ] Repo nomes-próprios (usar rrb-adv ou fixture real): abas nível 2, linha "reconhecido por nome", conteúdo certo.
- [ ] Repo sem doc: "não documentado", nenhuma aba quebra/inventa.
- [ ] Decisões resolve `DECISIONS.md` (arquivo) e `adr/*.md` (coleção).
- [ ] Mapeamento: corrigir fonte da Arquitetura escreve `.proplan/config.yml` (commit por `rrb-proplan[bot]`); aba usa nova fonte pós-sync.
- [ ] Marcar Deploy ausente (`null`) → aba para de oferecer CTA; sobrevive ao re-sync.
- [ ] Config vence convenção (config apontando outro arquivo com `docs/ARCHITECTURE.md` presente).
- [ ] Testes sem doc + com workflows → lista do CI com aviso.
- [ ] Nenhum arquivo do repo-alvo renomeado/movido/reescrito (só `.proplan/config.yml`).
- [ ] Nenhuma chamada de IA na fatia.
- [ ] **Cache reconstrói idêntico**: `DELETE FROM document_resolutions WHERE ...` + re-sync → mesmas 6 linhas.

- [ ] **Step 3: Correções pontuais** que a validação runtime exigir (bugs de borda), cada uma com seu commit.

---

### Task 20: Atualizar DEVELOPMENT.md + STATUS.md + commitar docs

**Files:**
- Modify: `docs/DEVELOPMENT.md` (Fatia 6: itens → `feito`, bloco de aceite runtime)
- Modify: `docs/STATUS.md` (Fatia 6 muda de coluna)
- Modify: `docs/superpowers/specs/2026-07-13-fatia-6-document-resolver-abas-design.md` (marcar critério cache como coberto, se aplicável)

- [ ] **Step 1: Marcar os 7 itens da Fatia 6 no DEVELOPMENT.md como `feito`** e adicionar o bloco "### Aceite runtime" com o resultado do checklist da Task 19 (formato das fatias anteriores).

- [ ] **Step 2: Atualizar STATUS.md** — mover a Fatia 6 de A Fazer para a coluna correspondente ao estado (entregue → Feito, aguardando aceite do PI).

- [ ] **Step 3: Commit final da entrega (código já commitado; aqui só docs)**

```bash
git add docs/DEVELOPMENT.md docs/STATUS.md docs/superpowers
git commit -m "docs: Fatia 6 entregue — DEVELOPMENT.md + STATUS.md atualizados"
```

---

## Self-Review (feita pelo autor do plano)

**Cobertura da SPEC-006** (cada requisito → task):
- DocumentResolver (níveis 1/2/4) → Tasks 1,2,4. ✔
- Tabela de alias em código, não-gananciosa → Task 2 (+ teste `archive ≠ arch`). ✔
- Diretório como fonte (coleção) → Task 4 (decisions/skills). ✔
- `.proplan/config.yml` vence tudo, `null` = ausente → Tasks 3,4. ✔
- Tela de mapeamento (confirmar/corrigir/ausente) → Tasks 16,17. ✔
- Aviso de resolução na aba (alias) → Task 9 (`TabFrame`). ✔
- Escopo de sync ampliado → Task 7. ✔
- Abas Arquitetura/Design/Decisões/Testes/Deploy/Skills → Tasks 9,14,15. ✔
- Mermaid no viewer, lazy, fallback → Task 9. ✔
- Fallback CI de Testes → Tasks 13,14. ✔
- Deploy sem IA → Task 14 (payload null quando ausente). ✔
- API `GET /tabs/:tab`, `GET/PUT /mapping` → Tasks 8,14,16. ✔
- Sem tabela do mapeamento (mora no repo) → config no repo; `DocumentResolution` é cache (Decisão 2). ✔
- Critério cache reconstrói idêntico → Task 19. ✔
- Nenhuma IA → Global Constraints + Task 19. ✔
- Repo nunca renomeado/reescrito → único write é config.yml (Task 16) + Task 19. ✔

**Placeholder scan**: os `- [ ]` são passos executáveis; os `[ ]` da Task 19 são o checklist de aceite (runtime, legítimo). Dois pontos marcados "confirmar ao ler o arquivo" (ownership no `TabsController`, assinatura de `installationToken`) são verificações de integração contra código existente, com a referência exata dada — não são TODOs de design.

**Consistência de tipos**: `Resolution` (entity/level/source/path/paths/confidence) idêntico da Task 1 até o front. `resolveDocuments`/`resolutionOf`/`getTab`/`getMapping`/`putMapping` com as mesmas assinaturas onde referenciadas. `parseDecisions`/`parseDeploy`/`parseSkills`/`parseWorkflow` batem entre parser e `TabsService`.
