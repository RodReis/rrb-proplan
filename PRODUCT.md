# PRODUCT.md — RRB ProPlan

> Atualizado em 2026-07-16 (Fatia 15/SPEC-020). A versão anterior descrevia a paleta pré-Carbono (marca `#1D2939`, Inter, neutros Untitled UI, âmbar = IA) — morta desde a re-tokenização. **Fonte de verdade visual é `docs/DESIGN.md`**; este arquivo resume o produto, não substitui o design system.

## Register

**product** — app UI (workspace de gestão de projetos). O design serve a tarefa; a referência é ferramenta (Linear, Untitled UI), nunca landing page.

Exceção: a tela de **Login** é pré-autenticação e carrega peso de marca (hero, mensagens de valor). É a única superfície do produto que joga no register brand.

## Users & Purpose

- **Usuário único no MVP**: Rodrigo (PI) — dev sênior gerenciando o portfólio dos próprios repos. Usa em desktop, sessões longas, luz ambiente normal.
- **Job**: enxergar o estado real de cada projeto (docs, board, deploy, contexto) sem abrir o repo; detectar quando a documentação mente.
- **Workflow**: catálogo (`/`) → um projeto por vez em `/p/:id/:tab`, com navegação vertical em grupos na sidebar. Escritas voltam pro GitHub via bot com progresso visível (SPEC-010 — silêncio é bug).

## Brand & Personality

- **Sóbrio, denso, confiável** — é painel de gestão, não campanha.
- **Carbono + prata, uma cor por vez** (DESIGN.md §1). A base é monocromática (grafite/prata); **não há cor vibrante de marca**. O acento é prata (`--accent` `#c9ced8` no Carbono, aço `#5b616c` no Claro) — não é um azul, não é um roxo.
- **Cor só carrega significado** (nunca decoração): verde = aceito/finalizado/sem custo · violeta = escrita no repositório · azul = leitura/IA · âmbar = em andamento/atenção · vermelho dessaturado = prioridade alta/erro.
- **Dois temas**: Carbono (padrão) e Claro. O tema troca **apenas** custom properties — nenhum componente conhece cor absoluta.
- Tipografia **IBM Plex Sans** (UI) + **IBM Plex Mono** (rótulos técnicos, caixa alta, espaçado), self-hosted via `@fontsource` — nunca CDN (ambiente 100% local).
- **Estados de IA sempre distinguíveis**: chip `INFERIDO POR IA · <provedor>` com contorno `--accentBorder` + ação `Regenerar`; arestas inferidas no grafo são tracejadas. Regra de produto (ADR-002), não estética.
- **O aceite é sempre humano** (ADR-011): "Feito" ≠ "Finalizado". Nenhuma automação fecha o que o dono não aceitou. Estados que aguardam o dono usam prata + verde, nunca urgência falsa.

## Anti-references

- Sem parallax, scroll-jacking, gradientes animados de fundo, confete (DESIGN.md §9 — Limites).
- **Sem hero-metric SaaS** (número grande + rótulo pequeno + acento em gradiente), sem glassmorphism decorativo. **Exceção registrada** (decisão do PI em 2026-07-16): os 4 sinais do topo da Visão Geral (`OverviewSignals`) usam a forma de cartão-métrica, fiéis ao protótipo. Vale porque cada um é **fato datado** que responde uma pergunta de gestão — nenhum é composto ou inventado (ADR-012 proíbe score de saúde), e sem dado o cartão diz `—` em vez de fingir zero (ADR-014). Escopo estrito: só esta faixa; não é licença para número grande em outra aba.
- **Nada anima em loop parado.** Exceções registradas no DESIGN.md §9: pulso de atividade, Ken Burns de imagem, e o carrossel do Login (só ele, pré-autenticação).
- Toast só para resultado do que **não** está na tela; gesto visível = feedback inline (DESIGN.md §8).
- **Ausência é informação, não falha** (ADR-014): documento que não existe leva rótulo `AGUARDA <arquivo>`, nunca cor de erro. O ProPlan se adapta ao repo — nunca renomeia, move ou impõe convenção.

## Accessibility

- `prefers-reduced-motion` obrigatório em toda animação (fallback: transição instantânea; opacity ainda permitida).
- Foco visível universal: `outline: 2px solid var(--accent)` — nunca remover sem substituto.
- Contraste AA nos dois temas nos pares texto/fundo do DESIGN.md §4.
- Animar só `transform`/`opacity`; toasts anunciados via `aria-live="polite"`; Esc sempre fecha modal/gaveta.

## Design system

Fonte de verdade visual: **`docs/DESIGN.md`** (tokens, componentes e regras de comportamento).

- **Tokens**: `apps/web/src/tokens.css` (custom properties por `:root[data-theme]`) + ponte Tailwind v4 `@theme` em `index.css` (utilitários apontam para as custom properties, então trocar `data-theme` re-pinta sem rebuild). Cor semântica que depende de **dado** (etapa do Kanban, prioridade) vive em `apps/web/src/stageTint.ts` — a única exceção à regra "componente só usa `var(--token)`".
- **Tema**: `apps/web/src/theme.tsx` (`ThemeProvider`, `data-theme` no `<html>`, persistido em localStorage). Dívida registrada na SPEC-020: migrar para preferência via API quando houver uma segunda preferência a guardar.
- **Componentes**: dnd-kit (Kanban), react-flow (Grafo), Framer Motion (orquestração), sonner (toast), CSS puro para hover/focus/press. **shadcn/ui é citado no DESIGN.md §12 mas não está instalado** — não presumir que existe.
- **Nenhum valor de cor hardcoded em componente**: `grep -rE '#[0-9a-fA-F]{3,8}' apps/web/src` só pode achar `tokens.css` e `stageTint.ts`. Atenção: o grep não pega o defeito mais comum — par de classes herdado da paleta antiga (ex.: `bg-brand text-white`, que virou branco sobre prata). Botão primário é `bg-btnbg text-btnfg`.
