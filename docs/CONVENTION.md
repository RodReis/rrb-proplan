# Convenção dos Projetos-Alvo

O **contrato de dados** do ProPlan: como cada aba do workspace descobre sua fonte no repo-alvo.

> **A convenção é o caminho ideal, não um requisito** (ADR-014). O ProPlan **se adapta ao seu repo** — ele nunca renomeia, move ou reescreve documento seu. Um repo que segue a convenção é resolvido sem esforço e com confiança cheia; um repo com nomes próprios é resolvido por alias ou por mapeamento manual; um repo sem o documento mostra **"não documentado"** e oferece bootstrar. **Ausência é informação, não falha.**

## Escada de resolução (ADR-014)

Para cada entidade, o ProPlan para no primeiro nível que resolver:

| nível | como | proveniência |
|---|---|---|
| **1. Convenção** | caminho exato + `proplan: v1` (tabela abaixo) | `fato`, confiança cheia |
| **2. Alias conhecido** | tabela determinística de nomes (case- e acento-insensitive) | `fato`, confiança levemente menor |
| **3. Classificação semântica** | conteúdo bate, nome não — IA (Fatia 7) | `inferência`, badge âmbar |
| **4. Ausente** | nada resolve | "não documentado" + CTA de bootstrap. **Nunca inventa** |

Arquivo que não resolve nenhuma entidade continua existindo como **documento livre** (aparece na aba Documentos e no grafo).

## Mapa aba → fonte

| Aba | Nível 1 (convenção) | Nível 2 (aliases reconhecidos) | Sem fonte |
|---|---|---|---|
| Visão Geral | metadados de commit (ADR-010, sem IA) | — | resumo por IA (versionado) |
| Kanban | **GitHub Issues** (label `proplan:*`; a issue só fecha no **aceite**) — ADR-011 | — | repo sem Issues → leitura de `docs/STATUS.md` (degradado) |
| Grafo | links explícitos entre MDs | — | arestas semânticas inferidas (`inferred`) |
| Arquitetura | `docs/ARCHITECTURE.md` | `architecture` · `arquitetura` · `arch` · `design-doc` · `docs/arch/` | IA (Fatia 7) → senão "não documentado" |
| Decisões / ADRs | `docs/DECISIONS.md` | `adr/` · `adrs/` · `decisions/` · `decisoes/` · `docs/adr/**` (diretório = coleção) | "não documentado" |
| Skills & Agentes | `CLAUDE.md`, `.claude/skills/`, `.claude/agents/` (parse) | `AGENTS.md` · `.cursorrules` · `.github/copilot-instructions.md` | "não configurado" (sem IA) |
| Testes & Ciclos | `docs/TESTING.md` | `testing` · `testes` · `qa` · `docs/qa/**` | parse de `.github/workflows/*.yml` |
| Design | `docs/DESIGN.md` | `design` · `ui` · `styleguide` | IA (Fatia 7) → senão "não documentado" |
| Deploy | `docs/DEPLOY.md` | `deploy` · `deployment` · `infra` · `RUNBOOK.md` | **sem fallback de IA** — deploy inferido errado é pior que ausente |
| Contexto / "o que não mexer" | `docs/CONTEXT.md` (v2, ADR-013) | — | pergunta ao humano (MVP2) |

Aliases casam com ou sem extensão, na raiz ou em `docs/`, com ou sem acento, em qualquer caixa. **Tabela de alias é código, não configuração do usuário** — ampliar exige commit e teste.

## `.proplan/config.yml` — mapeamento explícito

Quando alias e IA erram (ou quando o usuário quer ser explícito), o mapeamento é confirmado na UI e persistido no repo-alvo. **Vence todos os níveis da escada.**

```yaml
proplan: v2
mapping:
  architecture: docs/notas-tecnicas.md
  decisions: adr/          # diretório = coleção de ADRs
  deploy: null             # confirmado ausente — não perguntar de novo
  testing: docs/qa/estrategia.md
```

`null` é uma resposta legítima e **permanente**: significa "esse documento não existe neste projeto, e eu sei disso". A aba mostra o estado vazio sem CTA insistente.

## Frontmatter comum

Todo MD que segue a convenção (nível 1) abre com:

```yaml
---
proplan: v1
updated: 2026-07-12
---
```

O frontmatter é o que dá **confiança cheia** — ele diz "este arquivo é deliberadamente a fonte desta aba". Sem ele, o documento ainda pode ser resolvido por alias, mapeamento ou IA, com a confiança correspondente ao nível.

## Onde cada coisa mora: `docs/` × `.proplan/`

> **`docs/` = conteúdo humano. `.proplan/` = artefato gerado pelo ProPlan.**

Regra estrutural do produto (ADR-011, SPEC-005). Motivo: o cálculo de defasagem (ADR-010) usa o último commit em `path=docs` como sinal de "quando um humano mexeu na doc". Se o ProPlan commitasse seus próprios artefatos em `docs/`, esse sinal viraria ruído e o alerta de doc defasada morreria em silêncio — quanto mais o board fosse usado, mais cega ficaria a detecção.

| caminho | quem escreve | conta como frescor de doc? |
|---|---|---|
| `docs/**` | humano (direto no repo ou pela UI do ProPlan) | **sim** |
| `.proplan/**` | só o ProPlan (projeção do board; futuros handoff/drift) | **não** |

Atenção: `path=docs` na Commits API **inclui subdiretórios** — `docs/.proplan/` não resolveria nada. O artefato gerado fica na **raiz**, em `.proplan/`.

## `.proplan/STATUS.md` — projeção do Kanban (artefato gerado)

> **Não é fonte de verdade** (ADR-011). O estado do trabalho vive nas **GitHub Issues**. Este arquivo é um **retrato versionado** desse estado, gerado e commitado pelo ProPlan a cada mudança — existe para dar legibilidade humana, histórico no git e independência do ProPlan. **Escritor único: o ProPlan.** Edição manual é sobrescrita na próxima projeção (a UI avisa).

Colunas = seções H2 fixas. Card = item de lista, com o número da issue.

```markdown
---
proplan: v1
updated: 2026-07-12
---
<!-- gerado pelo ProPlan a partir das Issues — não edite à mão -->
# Status

## Backlog
- Exportar relatório PDF (#38, prio: baixa)

## A Fazer
- Tela de configurações (#42, prio: alta)

## Em Andamento
- Integração GitHub OAuth (#41)

## Feito
- Setup do projeto (#12 — entregue, aguardando aceite)

## Finalizado
- Fundação: monorepo e login (#3, aceito em: 2026-06-18)

## Descartado
- Migrar para GraphQL (#27, descartado em: 2026-07-02)
```

Mapeamento issue → coluna:

| coluna | estado da issue | significado |
|---|---|---|
| Backlog | `open` + `proplan:backlog` (ou `open` sem label `proplan:*`) | — |
| A Fazer | `open` + `proplan:todo` | — |
| Em Andamento | `open` + `proplan:doing` | — |
| **Feito** | **`open`** + `proplan:done` | entregue — **aguardando aceite do dono** |
| **Finalizado** | `closed` + `proplan:finalizado` | **aceito pelo dono** |
| **Descartado** | `closed` + `proplan:descartado` | decisão de não fazer |

**A issue só fecha quando o trabalho realmente acabou** — e quem fecha é o dono, aceitando. Fechar é ato deliberado, nunca efeito colateral de merge.

Issue nunca é deletada — descartar é fechar com label. `closed_at` marca o **aceite** (não a entrega).

**Nunca use `closes #N` num PR de repo gerenciado**: o merge fecharia a issue e **forjaria o aceite** do dono. Use `refs #N`. Se acontecer mesmo assim, a issue cai em **Finalizado** com badge **"fechada fora do ProPlan"** — o ProPlan não inventa aceite, ele **sinaliza a ausência de evidência**.

**Carimbo de aceite/descarte**: mover para Finalizado ou Descartado faz o ProPlan **comentar na issue** (`proplan: finalizado pelo PI em <data>`). `closed_at` marca a entrega; o comentário marca o aceite. Permanente, auditável, no GitHub.

Commit da projeção: `proplan: atualiza STATUS.md (projeção das Issues)`.

**Modo degradado** — repo com Issues desabilitada: o `docs/STATUS.md` (legado, formato antigo) volta a ser lido como fonte, o board fica **somente leitura** e a UI sinaliza. Nunca degrada em silêncio.

**`docs/STATUS.md` legado**: repo com o arquivo no formato antigo e sem issues `proplan:*` recebe aviso (badge no catálogo + banner no Kanban) com CTA de importação. A importação é **sempre manual**; o arquivo legado permanece no repo com um aviso de migração.

## `docs/DEPLOY.md` — Deploy

```markdown
---
proplan: v1
updated: 2026-07-12
---
# Deploy

## Ambientes
| Ambiente | Status | Plataforma | URL |
|---|---|---|---|
| produção | ativo | Vercel + Supabase | https://app.exemplo.com |
| homolog | inativo | — | — |
```

## `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/TESTING.md`

Formato livre com frontmatter. Recomendado: diagrama Mermaid na arquitetura; `TESTING.md` com seções `## Estratégia` e `## Ciclos executados` (tabela data/escopo/resultado).

## Links entre documentos (grafo)

- **Explícitos**: links markdown relativos (`[arquitetura](ARCHITECTURE.md)`) e wikilinks (`[[ARCHITECTURE]]`). Viram arestas `explicit`.
- **Inferidos**: o Insight sugere arestas semânticas entre docs sem link direto; renderizadas tracejadas e removíveis pelo usuário (persistência da remoção no banco).

## Documentos binários (preview sob demanda)

A aba **Documentos** lista **todo** arquivo de `docs/**` (e do escopo), em árvore de pastas — inclusive binários (`.pdf`, `.docx`, `.png`, `.html`, imagens). O `kind` é classificado por extensão:

- **markdown/texto** (`.md`, `.txt`, `.yml`…) alimenta as abas, o grafo e a resolução (conteúdo baixado e persistido).
- **binário** (`.pdf`/imagem/`.html`/`.docx`) é **só preview** — nunca vira fonte de aba nem nó de grafo. O banco guarda só o metadado; os bytes são buscados sob demanda do GitHub quando o preview abre (ADR-003, adendo 2026-07-13). `.docx` mostra o texto extraído; `.html` renderiza isolado (sandbox, sem scripts); `.xlsx`/`.pptx`/desconhecido → "pré-visualização não disponível".

## Versionamento da convenção

`proplan: v1`. Mudanças de formato incrementam a versão; o parser mantém compatibilidade com a anterior por, no mínimo, um ciclo.
