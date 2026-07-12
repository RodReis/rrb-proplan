# Convenção dos Projetos-Alvo

Este é o **contrato de dados** do ProPlan: o que cada projeto gerenciado deve ter em `docs/` para que as abas do workspace funcionem sem IA. Projetos legados não precisam aderir manualmente — o bootstrap (ADR-002) gera uma proposta desses arquivos por IA e o dono revisa e commita.

## Mapa aba → fonte

| Aba | Fonte primária | Fallback |
|---|---|---|
| Visão Geral | Metadados de commit (frescor de docs vs código — ADR-010, sem IA) | IA: resumo versionado (`README.md` + `CLAUDE.md` + `docs/`) |
| Kanban | `docs/STATUS.md` | Bootstrap IA propõe o arquivo |
| Grafo | Links explícitos entre MDs | Arestas semânticas inferidas, marcadas `inferred` |
| Arquitetura | `docs/ARCHITECTURE.md` | Inferência versionada |
| Skills & Agentes | `CLAUDE.md`, `.claude/skills/`, `.claude/agents/` (parse) | — (sem IA; se não há `.claude/`, aba mostra "não configurado") |
| Testes & Ciclos | `docs/TESTING.md` | Parse de `.github/workflows/*.yml` |
| Design | `docs/DESIGN.md` | Inferência versionada |
| Deploy | `docs/DEPLOY.md` | — (sem fallback: deploy inferido errado é pior que ausente) |

## Frontmatter comum

Todo MD da convenção abre com:

```yaml
---
proplan: v1
updated: 2026-07-12
---
```

Arquivo sem `proplan: v1` é tratado como documento livre (aparece no grafo, não alimenta abas).

## `docs/STATUS.md` — Kanban

Colunas = seções H2 fixas. Card = item de lista. Metadados opcionais entre parênteses.

```markdown
---
proplan: v1
updated: 2026-07-12
---
# Status

## Backlog
- Exportar relatório PDF (prio: baixa)

## A Fazer
- Tela de configurações (prio: alta)

## Em Andamento
- Integração GitHub OAuth (desde: 2026-07-01)

## Feito
- Setup do projeto (em: 2026-06-20)
```

Regras: as quatro seções são obrigatórias (mesmo vazias); mover card = mover a linha de seção; o ProPlan commita com mensagem `proplan: move "<card>" para <coluna>`.

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

## Versionamento da convenção

`proplan: v1`. Mudanças de formato incrementam a versão; o parser mantém compatibilidade com a anterior por, no mínimo, um ciclo.
