---
proplan: v1
updated: 2026-07-12
---
# Design — RRB ProPlan

Referência visual: Untitled UI (layout enviado pelo dono em 2026-07-12). O que se aproveita é o **shell de navegação e a linguagem visual**, não a tela de settings do exemplo.

## Shell da aplicação

```
┌──┬────────────┬──────────────────────────────────────┐
│R │ Sidebar    │ Header: nome do projeto · ações       │
│a │ contextual │ ┌──────────────────────────────────┐  │
│i │            │ │ Abas: Visão Geral | Kanban |     │  │
│l │ Projetos   │ │ Grafo | Arquitetura | Skills |   │  │
│  │ (lista de  │ │ Testes | Design | Deploy         │  │
│í │ repos      │ ├──────────────────────────────────┤  │
│c │ gerenciados│ │                                  │  │
│o │ + busca)   │ │ Conteúdo da aba ativa            │  │
│n │            │ │                                  │  │
│e │ ──────     │ └──────────────────────────────────┘  │
│s │ Config     │                                       │
└──┴────────────┴──────────────────────────────────────┘
```

- **Rail de ícones** (colapsável, como no exemplo): Projetos, Sync, Configurações. Avatar embaixo.
- **Sidebar contextual**: lista de projetos gerenciados com indicador de estado (● sincronizado, ◐ sync em andamento, ○ nunca ingerido, ⚠ conflito). Busca no topo.
- **Barra de abas** no padrão do exemplo (pills horizontais com contador quando aplicável — ex.: "Kanban 12"): é o mapa 1:1 das abas do workspace definidas em `CONVENTION.md`.
- **Header do workspace**: nome do repo, link pro GitHub, badge de origem do dado da aba ativa — `convenção` (sólido) vs `inferido por IA` (outline âmbar) + botão "promover a documento" quando inferido.

## Linguagem visual (tokens)

- **Paleta**: neutros quentes do Untitled UI — fundo `#FCFCFD`, superfícies `#FFFFFF`, bordas `#EAECF0`, texto `#101828`/`#475467`. **Marca carbono, sem cor vibrante** (decisão do PI 2026-07-12): estados ativos e CTAs usam carbono `#1D2939` (grafite escuro), com fundos sutis em cinza claro (`#F9FAFB`). Cor só aparece em sinais semânticos (âmbar IA, verde sucesso, vermelho erro).
- **Tipografia**: Inter; títulos 18/16 semibold, corpo 14, metadados 12.
- **Densidade**: espaçosa como o exemplo (padding 16–24px, divisores 1px em vez de cards com sombra).
- **Estados de IA sempre distinguíveis**: qualquer conteúdo inferido leva o badge âmbar e arestas inferidas no grafo são tracejadas. Regra de produto, não só estética (ADR-002).

## Notas por aba

- **Kanban**: 6 colunas fixas (`CONVENTION.md`): Backlog · A Fazer · Em Andamento · **Feito** · **Finalizado** · **Descartado**. **Feito é fila de aceite** — dá destaque (é ação pendente do PI, não conquista): contador em âmbar quando > 0. **Finalizado** é a conquista (verde). **Descartado** colapsada por padrão, cinza/riscado — é decisão, não fracasso.
  - **Card**: `#número` · título · label de prioridade · **avatar do assignee** no rodapé. **Sem assignee = espaço vazio**, nunca um placeholder cinza — ausência deve ser *visível*, não decorada. **Autor não é exibido** (sempre `proplan[bot]`/PI — avatar idêntico em todo card é ruído).
  - **Badge "sem dono"** (âmbar, discreto): card em **Em Andamento** sem assignee. Trabalho em curso sem responsável é a semente do projeto esquecido. Card mostra `#número` da issue, título, prioridade e link "abrir no GitHub". Ao mover: estado otimista + borda pulsante até a Issues API confirmar (ADR-011) — toast só no resultado, nunca no gesto. Sem `STATUS.md` importado: banner de importação no topo do board.
- **Grafo**: react-flow, nós = documentos (cor por tipo: convenção/livre/README), minimapa, clique abre o doc no viewer lateral.
- **Visão Geral**: **faixa de frescor** no topo (acima de tudo) + resumo IA em blocos "O que é / Onde parou / O que falta" + metadados do repo.
- **Faixa de frescor** (ADR-010): faixa horizontal full-width, altura de uma linha, cantos `md`. Sempre exibe `Docs: há X · Código: há Y` (datas relativas). Dentro do limiar → fundo `surface`, texto `muted`, sem ícone — informação, não aviso. Acima do limiar → fundo âmbar 10%, borda âmbar 30%, ícone ⚠️ e "Documentação possivelmente defasada", com tooltip explicando o cálculo e onde mudar o limiar. **Nunca é vermelha** — não é erro, é um sinal; e nunca bloqueia ou esconde o conteúdo abaixo. Entrada: fade, sem slide (não competir com o stagger dos blocos).
- **Deploy**: tabela de ambientes idêntica ao formato do `DEPLOY.md` — renderização direta, sem transformação.

## Design system (extraído do layout de referência)

Tokens formalizados como CSS variables + Tailwind config — nenhum valor hardcoded em componente.

| Grupo | Tokens |
|---|---|
| Cor | `bg: #FCFCFD` · `surface: #FFFFFF` · `surface-hover: #F9FAFB` · `border: #EAECF0` · `text: #101828` · `text-muted: #475467` · `brand: #1D2939` (carbono — ativos/CTAs) · `warning: #F79009` (badge IA) · `success: #12B76A` · `error: #F04438` |
| Raio | `sm: 6px` (inputs, badges) · `md: 8px` (cards) · `lg: 12px` (modais, painéis) · `full` (pills de aba) |
| Sombra | `xs` (cards em hover) · `md` (dropdown, popover) · `lg` (modal). Repouso = borda 1px, sem sombra |
| Espaço | Escala 4px; padding de seção 16–24px |
| Tipo | Inter · display 18/16 semibold · corpo 14 · meta 12 |
| Motion | `fast: 150ms` (hover, focus) · `base: 200ms` (abas, toast, dropdown) · `slow: 250ms` (painel lateral, modal) · easing `cubic-bezier(0.16, 1, 0.3, 1)` |

## Animações e efeitos

Motion com propósito — comunica mudança de estado, nunca decoração gratuita. Regra de ouro: efeito responde a uma ação do usuário ou a uma mudança de estado do sistema; nada anima em loop parado (exceção única: pulso de "commitando").

### Micro-interações por componente

**Cards** (Kanban, projeto na sidebar, blocos da Visão Geral)

- Hover: lift de 2px (`translateY(-2px)`) + sombra `xs` + borda `border → brand/30%` (`fast`).
- Entrada em lista: fade + slide-up 12px com stagger de 40ms entre cards (`base`), só na primeira montagem — refetch não re-anima.
- Drag (Kanban): tilt 2°, sombra `md`, escala 1.02; placeholder tracejado na posição de origem; soltar = spring curto (stiffness 400, damping 30).
- Estado "commitando": borda pulsando `brand → transparent` em 1.2s até o webhook confirmar.

**Botões**

- Hover: fundo escurece um passo (`fast`); primário ganha sombra `xs`.
- Press: escala 0.97 (`fast`) — feedback tátil.
- Loading: label desliza pra cima e entra spinner de 14px no lugar; largura do botão fixa (sem "pulo" de layout).
- Sucesso pontual (ex.: "Copiar"): ícone troca por check com micro-scale, volta em 1.5s.

**Links e itens de navegação**

- Links inline: underline animado da esquerda pra direita no hover (`fast`), cor `brand`.
- Abas: indicador ativo desliza entre pills (layout animation do Framer Motion, `base`) — não pisca de uma pra outra.
- Itens do rail/sidebar: fundo `surface → #F9FAFB` (`fast`); ícone com micro-scale 1.05; item ativo com barra lateral de 2px `brand` que cresce de baixo pra cima (`fast`).

**Bordas e focus**

- Focus visível universal: ring de 4px `brand/25%` + borda `brand` (padrão Untitled UI), transição `fast`. Nunca remover outline sem substituto.
- Inputs: borda `border → brand` no focus com o ring acima; erro = borda `error` + shake horizontal de 4px, 2 ciclos, 300ms.
- Borda-destaque de conteúdo IA: badge âmbar com shimmer sutil único na entrada (1 passada, não loop).
- Divisores de seção: sem animação — âncora visual estável.

**Menus, dropdowns e popovers**

- Abertura: origin no trigger, scale 0.96 → 1 + fade (`base`); fechamento mais rápido (`fast`) — sair deve ser mais ágil que entrar.
- Itens: highlight instantâneo no hover (0ms — menu lento irrita), check de seleção com micro-fade.
- Submenu: desliza 4px da direção de origem.
- Modal/painel lateral: overlay fade (`base`) + painel slide/scale (`slow`); fechar com Esc sempre.

### Efeitos de superfície

- **Skeletons** (não spinners) em toda carga de aba, com shimmer de 1.5s.
- **Grafo**: nós entram com stagger de 30ms; hover destaca vizinhos e esmaece o resto (`fast`); pan/zoom com inércia leve.
- **Sidebar/rail**: colapso animado (`slow`) com fade dos labels antes da largura, como no layout de referência.
- **Empty states**: ilustração + CTA entram com fade + slide-up (`base`).

### Limites (o que "moderno" não significa aqui)

Sem parallax, sem animação de scroll-jacking, sem gradientes animados de fundo, sem confete. Densidade de informação vem primeiro — é uma ferramenta de gestão, não uma landing page.

### Acessibilidade e implementação

- Tudo atrás de `prefers-reduced-motion`: usuário com motion reduzido recebe transições instantâneas (opacity ainda permitida).
- Animar apenas `transform` e `opacity` (compositor); nunca `width/height/top` em listas grandes.
- Framer Motion para orquestração (abas, layout animations, stagger, presença de modais); CSS puro para hover/focus/press.

## Política de toasts

Regra: **toast comunica resultado do que o usuário não está vendo; estado inline comunica o que ele está vendo.**

| Evento | Feedback |
|---|---|
| Mover card (otimista) | Inline: borda pulsante no card — sem toast |
| Commit confirmado pelo webhook | Toast success "Alterações salvas no repo" (padrão `Changes saved` da referência) |
| Falha/conflito de commit | Toast error persistente (não auto-fecha) com ação "Resolver" |
| Sync concluído em background | Toast info com resumo ("3 docs atualizados") |
| Bootstrap IA pronto para revisão | Toast com ação "Revisar proposta" |
| Trocar aba, filtrar, buscar, colapsar sidebar | Nada — a própria UI é o feedback |

Racional: toast em toda ação treina o usuário a ignorá-los (fadiga de notificação) e mascara o canal quando um erro real aparece. Toasts empilham no canto inferior direito, máx. 3 visíveis, auto-fecham em 5s exceto erros.

## Componentes

shadcn/ui como base (Tabs, Dialog, Badge, Sonner para toasts) com os tokens acima; dnd-kit no Kanban; react-flow no grafo; Framer Motion. Sem biblioteca de UI pesada por cima.
