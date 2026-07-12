# CLAUDE.md — RRB ProPlan

## Papéis e governança

- **Rodrigo Reis (PI)** — decide escopo, prioridades e trade-offs; aprova specs e aceita entregas.
- **Claude Cowork (planejamento)** — especifica e mantém `docs/` e as specs em `docs/specs/`. Antes de finalizar qualquer spec, apresenta as perguntas abertas e dúvidas ao PI — spec só vira `aprovada-pi` com todas resolvidas (evitar retrabalho). **Nunca implementa código** — implementação é exclusiva do Claude Code.
- **Claude Code (você)** — planeja, codifica, testa (código, UX e UI — pode usar as skills do impeccable), atualiza a documentação e **sempre commita todos os documentos de `docs/`** junto da entrega. Implementa a partir deste arquivo + `docs/` + spec da feature em `docs/specs/`. Pode criticar arquitetura, **não escopo**. Sem spec para a tarefa, ou spec ambígua → perguntar ao PI antes de codificar, nunca assumir. Deve apontar problemas técnicos da spec — a correção passa pelo PI.

## Regras de trabalho

- **Idioma**: documentação, specs, commits e comunicação sempre em português (pt-BR); código e identificadores em inglês.
- **Sem hardcode e sem mock** — dado local de desenvolvimento entra via seed (`prisma/seed.ts`), criado na primeira fatia que precisar.
- **Ambiente 100% local até o fim do MVP** (docker-compose; sem deploy em nuvem).
- **Portas**: web `5180` (strictPort — se ocupada, falha em vez de trocar), API `3000`.

## O que é

Painel de gestão visual de projetos de software. Ingere documentação (nunca código) de repos GitHub e renderiza workspace com abas: Visão Geral, Kanban, Grafo, Arquitetura, Skills & Agentes, Testes, Design, Deploy. Usuário único no MVP; multi-tenant no futuro.

## Regras de arquitetura (não violar)

- **Monolito modular NestJS.** Módulos: `catalog`, `ingestion`, `insight`, `board`, `identity` (futuro). Módulos se comunicam por interfaces públicas (services exportados) — nunca importar entidades internas de outro módulo. Ver `docs/ARCHITECTURE.md`.
- **Nunca clonar repositórios.** Toda leitura via GitHub Contents/Git Trees API, restrita a `docs/`, `README.md`, `CLAUDE.md`, `.claude/`, `.github/workflows/`.
- **Inferência de IA sempre versionada.** Persistir com `docs_tree_sha` de entrada. Nunca chamar a Anthropic API no caminho de renderização de uma request.
- **Repositório é fonte de verdade.** Mutações de Kanban geram commit em `docs/STATUS.md` no repo-alvo. Banco = índice/cache. Conflito: comparar SHA base; divergiu → re-sync e reaplicar.
- **Jobs assíncronos via BullMQ** (Redis). Não introduzir Kafka sem revisar ADR-004.

## Stack

NestJS + TypeScript · React + Vite (react-flow, dnd-kit) · PostgreSQL/Supabase · Prisma · Redis/BullMQ · GitHub API via fetch (Octokit v4+ é ESM-only e conflita com o build CJS do Nest — não reintroduzir sem resolver isso) · Anthropic API.

## Convenções de código

- Estrutura por módulo: `presentation/` (controllers), `application/` (use cases), `domain/` (entidades, regras), `infrastructure/` (repositórios, clients).
- Testes junto ao módulo (`*.spec.ts`); e2e em `test/`.
- Commits em português, imperativo, prefixo do módulo: `catalog: adiciona listagem de repos`.

## Documentos-chave

- `docs/DEVELOPMENT.md` — **sua ordem de execução e status por item (você é o dono; atualize a cada entrega junto com STATUS.md)**
- `docs/ARCHITECTURE.md` — desenho, módulos, dados, resiliência
- `docs/DECISIONS.md` — ADRs (ler antes de propor mudança estrutural)
- `docs/CONVENTION.md` — contrato de dados dos projetos-alvo (o coração do produto)
- `docs/DESIGN.md` — shell de UI, tokens e padrões por aba (referência: Untitled UI)
- `docs/STATUS.md` — Kanban/roadmap deste projeto (mantenha atualizado ao concluir fatias)
