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

- **`DocumentResolver`** (novo, em `board/domain`): dada uma entidade (`architecture`, `decisions`, `design`, `testing`, `deploy`, `skills`), devolve `{ level: 1|2|4, path|paths, confidence, source: 'convention'|'alias'|'config'|'absent' }`. Nível 3 (IA) fica na Fatia 7 — o resolver já nasce com o slot.
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
- [ ] Aba Testes sem doc mas com workflows mostra a lista do CI com o aviso de origem.
- [ ] **Nenhum arquivo do repo-alvo é renomeado, movido ou reescrito** em nenhum fluxo desta fatia (o único write é `.proplan/config.yml`).
- [ ] Nenhuma chamada de IA em toda a fatia.

## Contratos

- `board/domain`: `DocumentResolver` (interface acima) + `ProplanConfig` (parse de `.proplan/config.yml`, tolerante a arquivo ausente/inválido → cai na escada).
- Parsers no `board`: `TestingDoc`, `DeployDoc`, `SkillsIndex`, `DecisionsIndex` (arquivo **ou** coleção) — derivados de `documents`, sem tabelas novas.
- API: `GET /projects/:id/tabs/:tab` → payload estruturado + `{ source: { level, path, confidence } }` (o front não conhece a regra de resolução) · `GET /projects/:id/mapping` (o que o resolver decidiu, por entidade, + candidatos) · `PUT /projects/:id/mapping` → escreve `.proplan/config.yml` (202, write-back + re-sync).
- Sem tabela nova: o mapeamento **mora no repo**, não no banco (regra do ADR-011 — o projeto tem que ser retomável sem o ProPlan).

## Notas técnicas

- **Ordem de implementação**: o `DocumentResolver` e seus testes vêm **primeiro**. As abas são consumidoras dele. Testar o resolver com fixtures de repo real (nomes esquisitos) antes de encostar na UI.
- **Alias não pode ser ganancioso**: casar `docs/design-system/README.md` como "Design" é aceitável; casar qualquer arquivo com "arch" no nome (ex.: `docs/archive/notas.md`) **não é**. Regras de alias exigem casamento do **nome do arquivo/diretório inteiro** (sem extensão), não substring. `archive` ≠ `arch`. Teste unitário explícito para esse caso.
- **Confiança por nível** alimenta o sinal `cobertura` do ADR-012 (MVP2) — o resolver já devolve `confidence`; nada consome ainda.
- Mermaid: client-side, lazy-loaded, com fallback para código em erro de sintaxe — diagrama quebrado não derruba a aba.
- Parse de workflow YAML: `name`, `on`, jobs (nome + runs-on). Nada além; não interpretar steps.
- `.proplan/config.yml` inválido (YAML quebrado): **não falha o sync** — loga, ignora a config, cai na escada, e a UI avisa "config do ProPlan inválida neste repo".

## Perguntas abertas

Nenhuma. ADR-014 aprovado pelo PI em 2026-07-12: escada de 4 níveis ✔ · alias determinístico em código ✔ · `.proplan/config.yml` como mapeamento explícito e vencedor ✔ · `null` = ausência confirmada ✔ · ProPlan nunca renomeia/move/reescreve doc do usuário ✔ · nível 3 (IA) fica na Fatia 7 ✔
