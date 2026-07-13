---
proplan: v1
spec: SPEC-006
fatia: 6
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-006 — Resolução de documentos + abas: Arquitetura, Decisões, Design, Testes, Deploy, Skills & Agentes

> **Ampliada em 2026-07-12 (ADR-014).** A versão anterior casava documento por **caminho exato** — o que funciona neste repo e falha em praticamente todos os outros do PI. Entram nesta fatia os níveis 1, 2 e 4 da escada de resolução e o `.proplan/config.yml`. O nível 3 (classificação semântica por IA) continua na Fatia 7.

## Objetivo

Completar o workspace **em repos reais, não só nos que seguem a convenção**: cada aba resolve sua fonte pela escada do ADR-014 (convenção → alias → mapeamento manual → ausente), e o usuário corrige o que o ProPlan errou sem renomear um único arquivo do próprio projeto.

## Escopo

### Resolução de documentos (ADR-014) — o coração da fatia

> ⚠️ **Correção de 2026-07-13**: a versão anterior desta spec dizia `board/domain`. **Errado.** Ver ADR-014 (seção "Onde o resolver mora"). O resolver é o **padrão do ADR-002 aplicado a caminho em vez de conteúdo** — determinístico no `ingestion`, IA como artefato versionado no `insight`, `board` só consome.

**Onde cada parte mora:**

| módulo | o quê |
|---|---|
| **`ingestion`** | níveis **1, 2 e 4** — casamento determinístico de caminho (convenção → alias → `.proplan/config.yml` → ausente). Ele já é dono da tabela `documents` e já sincroniza/parseia o `config.yml`. **Resolve e persiste no `sync-job`.** |
| **`insight`** | nível **3** (Fatia 7) — classificação semântica, job assíncrono versionado por `docs_tree_sha`. O store de resolução já nasce com o slot. |
| **`board`** | **apenas lê** a resolução para compor a aba. **Nunca resolve.** |

- **`DocumentResolver`** (novo, em **`ingestion/domain`**): dada uma entidade (`architecture`, `decisions`, `design`, `testing`, `deploy`, `skills`), devolve `{ level: 1|2|4, path|paths, confidence, source: 'convention'|'alias'|'config'|'absent' }`. Puro, sem IA, testável isolado.
- **A resolução é persistida no sync**, não calculada no render — mesma disciplina do ADR-002. Recalculada quando `docs_tree_sha` ou o `config.yml` mudam (que é exatamente o gatilho do sync).
- **Tabela de alias**: constante em código (não configuração do usuário), conforme a `CONVENTION.md`. Casa com/sem acento, qualquer caixa, na raiz ou em `docs/`, com/sem extensão. **Diretório como fonte** é caso de primeira classe (`adr/`, `docs/qa/`) — resolve para uma **coleção** de documentos, não um só.
- **`.proplan/config.yml`**: lido no sync; **vence todos os níveis**. `null` explícito = "confirmado ausente", e a aba deixa de insistir no CTA.
- **Tela de mapeamento** (nova, no workspace): mostra o que o resolver decidiu por entidade, com o nível e o caminho. O usuário confirma, corrige (seleciona outro arquivo/diretório do repo) ou marca como ausente → **escreve `.proplan/config.yml`** via write-back compartilhado. É o mesmo mecanismo de asserção humana do ADR-013, aparecendo já no MVP1.
- **Aviso de resolução na aba**: aba resolvida por alias exibe uma linha discreta `Fonte: docs/arquitetura.md (reconhecido por nome — corrigir)`. Aba de nível 1 não exibe nada (é o esperado).

### Ingestion

- Escopo ampliado do filtro de sync: `.claude/**`, `.github/workflows/*.yml`, **`.proplan/config.yml`** e os **diretórios de alias** (`adr/`, `adrs/`, `decisions/`, `docs/**`). Mesmo pipeline, mesmo hash. Re-sync popula.

### Abas

- **Arquitetura**: renderiza a fonte resolvida. **Mermaid no viewer entra aqui** (registrado na SPEC-002) — vale para todas as abas e para Documentos. Sem fonte → "não documentado" + CTA ("gerar proposta por IA" fica disponível na Fatia 7).
- **Decisões / ADRs** (aba nova, exigida pelo ADR-014): fonte pode ser **um arquivo** (`DECISIONS.md`) ou uma **coleção** (`adr/0001-*.md`). Renderiza como lista de decisões (título + status + data quando parseáveis do frontmatter/H1), clicável para o documento inteiro.
- **Design**: renderiza a fonte resolvida. Mesmo comportamento.
- **Testes & Ciclos**: fonte resolvida (`TESTING.md`/`qa/`); **fallback determinístico**: parse de `.github/workflows/*.yml` → workflows, jobs e gatilhos, com aviso "inferido do CI".
- **Deploy**: tabela de ambientes como componente estruturado (badges: ativo=success, inativo=neutro), não markdown cru. **Sem fallback de IA, nunca** — vazio com CTA.
- **Skills & Agentes**: parse determinístico (sem IA) de `CLAUDE.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md` — e, por alias, `AGENTS.md`. Nome + descrição do frontmatter, agrupados. Sem nada → "não configurado".
- **Web**: as abas saem de desabilitadas; empty states conforme `DESIGN.md`.

## Fora de escopo

**Nível 3 da escada** (classificação semântica por IA — Fatia 7). Qualquer chamada de IA nesta fatia. Edição de documentos pelas abas. Execução/estatística real de testes (limite do ADR-003). Criação de `DEPLOY.md` pela UI. **Renomear, mover ou reescrever qualquer documento do repo-alvo** — proibido por ADR-014, em qualquer fatia.

## Critérios de aceite

- [ ] **Repo que segue a convenção** (o próprio rrb-proplan): todas as abas resolvem em nível 1, sem aviso de fonte; Arquitetura renderiza o Mermaid **desenhado**, não como bloco de código.
- [ ] **Repo com nomes próprios** (fixture: `docs/arquitetura.md` + `adr/0001-x.md` + `docs/qa/estrategia.md`, sem frontmatter `proplan`): as abas resolvem em **nível 2**, exibem a linha "reconhecido por nome" e o conteúdo certo. **Este é o teste que prova a fatia.**
- [ ] **Repo sem doc nenhum**: abas mostram "não documentado" — nenhuma aba inventa conteúdo, nenhuma quebra.
- [ ] Aba Decisões resolve tanto `docs/DECISIONS.md` (arquivo) quanto `adr/*.md` (coleção), listando as decisões.
- [ ] Tela de mapeamento: corrigir a fonte da Arquitetura para um arquivo arbitrário do repo **escreve `.proplan/config.yml`**, e a aba passa a usar a nova fonte após o re-sync.
- [ ] Marcar Deploy como **ausente** (`null`) no mapeamento faz a aba parar de oferecer o CTA — e a escolha **sobrevive ao re-sync** (está no repo, não no banco).
- [ ] `.proplan/config.yml` **vence** convenção e alias (teste: repo com `docs/ARCHITECTURE.md` **e** config apontando para outro arquivo → vence a config).
- [ ] **`DocumentResolution` é cache, e o teste prova**: apagar as linhas do banco e ressincronizar reconstrói a resolução idêntica — **nenhuma decisão do usuário é perdida** (ela está no `.proplan/config.yml`, no repo).
- [ ] Aba Testes sem doc mas com workflows mostra a lista do CI com o aviso de origem.
- [ ] **Nenhum arquivo do repo-alvo é renomeado, movido ou reescrito** em nenhum fluxo desta fatia (o único write é `.proplan/config.yml`).
- [ ] Nenhuma chamada de IA em toda a fatia.

## Contratos

- **`ingestion/domain`**: `DocumentResolver` (interface acima) + `ProplanConfig` (parse de `.proplan/config.yml`, tolerante a arquivo ausente/inválido → cai na escada). `SyncService` resolve e persiste ao fim do run.
- **Prisma**: `DocumentResolution { id, projectId, entity, level, source, path?, paths String[], confidence, docsTreeSha, resolvedAt, @@unique([projectId, entity]) }` — recomputada a cada sync. Nível 3 (Fatia 7) grava aqui também, com `source: 'inference'`; **nunca sobrescreve** uma linha de `source: 'config'`.
- **Parsers de conteúdo no `board`** (composição de aba, a partir do path já resolvido): `TestingDoc`, `DeployDoc`, `SkillsIndex`, `DecisionsIndex` (arquivo **ou** coleção) — derivados de `documents`, sem tabelas novas.
- **`board` consome `IngestionService.resolutionOf(projectId, entity)`** — interface pública. **Não importa o `DocumentResolver` nem o `insight`** (regra de fronteira do ADR-001).

### Fonte × cache — a distinção que a versão anterior desta spec borrou

> A versão anterior dizia *"sem tabela nova: o mapeamento mora no repo"* **e** listava uma tabela nova na mesma seção. Contradição de redação, corrigida em 2026-07-13.

| | o quê | onde | por quê |
|---|---|---|---|
| **Mapeamento** | o que o **usuário decidiu** (`architecture: docs/notas.md`) | **`.proplan/config.yml`, no repo** | **fonte de verdade** — o projeto tem que ser retomável sem o ProPlan (ADR-011) |
| **Resolução** | o que o ProPlan **calculou** (`architecture → docs/notas.md, nível 2, conf. 0.8`) | **`DocumentResolution`, no banco** | **cache derivado**, recomputado a cada sync — como `documents`, `doc_links` e `issues` já são |

Não existe "tabela nova" no sentido que a regra proibia (guardar **decisão do usuário** fora do repo). Existe **mais um cache derivado** — o padrão que o projeto inteiro já usa. Apagar o banco e ressincronizar reconstrói a resolução inteira, sem perda: **é o teste que prova que ela é cache.**
- API: `GET /projects/:id/tabs/:tab` → payload estruturado + `{ source: { level, path, confidence } }` (o front não conhece a regra de resolução) · `GET /projects/:id/mapping` (o que o resolver decidiu, por entidade, + candidatos) · `PUT /projects/:id/mapping` → escreve `.proplan/config.yml` (202, write-back + re-sync).
- **O mapeamento do usuário mora no repo** (`.proplan/config.yml`), nunca no banco — regra do ADR-011: o projeto tem que ser retomável sem o ProPlan. A tabela `DocumentResolution` **não viola isso**: ela é cache derivado, não decisão. Ver "Fonte × cache" acima.

## Notas técnicas

- **Ordem de implementação**: o `DocumentResolver` (em `ingestion/domain`) e seus testes vêm **primeiro**. As abas são consumidoras dele, via interface pública do `ingestion`. Testar o resolver com fixtures de repo real (nomes esquisitos) antes de encostar na UI.
- **Por que não no `board`, nem no `insight`** (ADR-014): resolver caminho é propriedade do **índice de documentos** (dono: `ingestion`), não composição de aba nem interpretação de conteúdo. Pôr o resolver inteiro no `insight` faria o `board` depender do módulo de IA **só para renderizar** — encostando a IA no caminho de render, que o ADR-002 proíbe.
- **A resolução é persistida, não calculada no render.** Mesma disciplina do ADR-002/ADR-010: computar no job, servir do banco.
- **Alias não pode ser ganancioso**: casar `docs/design-system/README.md` como "Design" é aceitável; casar qualquer arquivo com "arch" no nome (ex.: `docs/archive/notas.md`) **não é**. Regras de alias exigem casamento do **nome do arquivo/diretório inteiro** (sem extensão), não substring. `archive` ≠ `arch`. Teste unitário explícito para esse caso.
- **Confiança por nível** alimenta o sinal `cobertura` do ADR-012 (MVP2) — o resolver já devolve `confidence`; nada consome ainda.
- Mermaid: client-side, lazy-loaded, com fallback para código em erro de sintaxe — diagrama quebrado não derruba a aba.
- Parse de workflow YAML: `name`, `on`, jobs (nome + runs-on). Nada além; não interpretar steps.
- `.proplan/config.yml` inválido (YAML quebrado): **não falha o sync** — loga, ignora a config, cai na escada, e a UI avisa "config do ProPlan inválida neste repo".

## Perguntas abertas

Nenhuma. ADR-014 aprovado pelo PI em 2026-07-12: escada de 4 níveis ✔ · alias determinístico em código ✔ · `.proplan/config.yml` como mapeamento explícito e vencedor ✔ · `null` = ausência confirmada ✔ · ProPlan nunca renomeia/move/reescreve doc do usuário ✔ · nível 3 (IA) fica na Fatia 7 ✔
