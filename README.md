# RRB ProPlan

Painel de gestão visual do ciclo de vida dos projetos da fábrica de software. Resolve o problema de **retomar projetos esquecidos**: seleciona um repositório do GitHub, ingere apenas a documentação (`docs/`, `README.md`, `CLAUDE.md`, `.claude/`) e monta um workspace com visões que respondem "o que é este projeto, onde parou e o que falta".

## Visões do workspace

| Aba | Pergunta que responde | Fonte de dados |
|---|---|---|
| Visão Geral | O que é? Onde parou? O que falta? | IA (artefato versionado por SHA) |
| Kanban | Feito / em andamento / a fazer / backlog | `docs/STATUS.md` (convenção, write-back via commit) |
| Grafo | Como os documentos se relacionam? | Links extraídos dos MDs + arestas semânticas inferidas (marcadas) |
| Arquitetura | Como o sistema é desenhado? | `docs/ARCHITECTURE.md`; fallback: inferência versionada |
| Skills & Agentes | O que o Claude Code usa neste projeto? | Parse determinístico de `CLAUDE.md` + `.claude/` |
| Testes & Ciclos | Foi testado? Como? | `docs/TESTING.md`; fallback: parse de `.github/workflows` |
| Design | Qual o design do sistema? | `docs/DESIGN.md`; fallback: inferência versionada |
| Deploy | Está em produção? Em quais plataformas? | `docs/DEPLOY.md` (convenção) |

## Princípios

1. **Sem código-fonte**: só documentação. Ingestão via GitHub Contents API — nunca clone completo.
2. **Convenção antes de inferência**: se o documento padronizado existe, ele é a verdade. IA é bootstrap (gera a primeira versão para projetos legados, o dono revisa e commita) e fallback.
3. **Inferência nunca em tempo real**: todo resultado de IA é artefato persistido, chaveado pelo SHA da árvore `docs/` — regenerado só quando os docs mudam.
4. **O repositório é a fonte de verdade**: mover um card no Kanban edita `docs/STATUS.md` e commita via API. O banco é cache/índice, não dono do dado.

## Stack

Monolito modular **NestJS** (módulos DDD extraíveis) · **React** (react-flow para grafo, dnd-kit para Kanban) · **PostgreSQL (Supabase)** · **Redis + BullMQ** (jobs de sync/ingestão/IA) · **Octokit** (GitHub API + webhooks) · **Anthropic API** (bootstrap e inferência).

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Decisões (ADRs)](docs/DECISIONS.md)
- [Convenção dos projetos-alvo](docs/CONVENTION.md)
- [Design / UI](docs/DESIGN.md)
- [Status / Roadmap](docs/STATUS.md)
