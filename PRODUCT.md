# PRODUCT.md — RRB ProPlan

## Register

**product** — app UI (workspace de gestão de projetos). O design serve a tarefa; a referência é ferramenta (Linear/Untitled UI), nunca landing page.

## Users & Purpose

- **Usuário único no MVP**: Rodrigo (PI) — dev sênior gerenciando o portfólio dos próprios repos. Usa em desktop, sessões longas, luz ambiente normal.
- **Job**: enxergar o estado real de cada projeto (docs, board, deploy, contexto) sem abrir o repo; detectar quando a documentação mente.
- **Workflow**: navegação por abas dentro de um workspace por projeto; escritas voltam pro GitHub via bot com progresso visível (SPEC-010 — silêncio é bug).

## Brand & Personality

- **Sóbrio, denso, confiável** — é painel de gestão, não campanha.
- **Marca carbono** (`#1D2939`), sem cor vibrante de marca (decisão do PI 2026-07-12). Cor só em sinais semânticos: âmbar = IA/atenção/aceite pendente · verde = sucesso/finalizado · vermelho = erro.
- Neutros quentes Untitled UI; Inter; densidade espaçosa (padding 16–24, divisores 1px, sem sombra em repouso).
- Estados de IA **sempre distinguíveis** (badge âmbar) — regra de produto, não estética.

## Anti-references

- Sem parallax, scroll-jacking, gradientes animados, confete (DESIGN.md → Limites).
- Sem hero-metric SaaS, sem glassmorphism decorativo.
- Toast só para resultado do que não está na tela; gesto visível = feedback inline.

## Accessibility

- `prefers-reduced-motion` obrigatório em toda animação (fallback: transição instantânea/opacity).
- Focus ring universal 4px `brand/25%` + borda `brand` — nunca remover outline sem substituto.
- Animar só `transform`/`opacity`.

## Design system

Fonte de verdade visual: `docs/DESIGN.md` (tokens em `apps/web/src/index.css`, Tailwind v4 `@theme`). Componentes: shadcn/ui como base, Framer Motion para orquestração, CSS puro para hover/focus/press.
