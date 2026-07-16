# DESIGN.md — ponteiro

A fonte de verdade de design deste projeto é **[`docs/DESIGN.md`](docs/DESIGN.md)** — tokens, componentes e regras de comportamento (Carbono/Claro).

Este arquivo existe só porque ferramentas que leem contexto na raiz do repo (ex.: a skill `impeccable`) não descem até `docs/`. **Não escreva design aqui**: qualquer decisão visual vai em `docs/DESIGN.md`, ao lado das demais docs humanas (`docs/` = conteúdo humano — CLAUDE.md).

Implementação: tokens em `apps/web/src/tokens.css`, tintas por dado em `apps/web/src/stageTint.ts`, tema em `apps/web/src/theme.tsx`, ponte Tailwind `@theme` em `apps/web/src/index.css`.
