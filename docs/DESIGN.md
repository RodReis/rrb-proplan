---
proplan: v1
updated: 2026-07-15
---
# Design — RRB ProPlan

> Painel de governança de projetos · tema **Carbono** (padrão) e **Claro** · fonte visual: protótipos em `docs/design/` (Login, Catálogo, Workspace — 2026-07-15).
>
> Este arquivo é a **fonte única** de design: tokens, componentes E regras de comportamento. Substitui o par DESIGN.md/DESIGN-SYSTEM.md anterior (referência Untitled UI, 2026-07-12). Onde protótipo e este documento divergirem, **este documento vence**.

## 1. Princípios

1. **Carbono + prata, uma cor por vez.** A base é monocromática (grafite/prata). Cor só carrega **significado**: verde = aceito/sem custo, violeta = escrita no repositório, azul = leitura/IA, âmbar = em andamento/atenção, vermelho dessaturado = prioridade alta/erro.
2. **O aceite é sempre humano.** Estados que dependem do dono ("aguarda seu aceite") usam prata + verde e nunca são fechados por automação (ADR-011).
3. **Sem buraco de silêncio.** Toda operação de escrita tem presença visual em 3 camadas: pílula viva (topbar) → gaveta de atividade → toast. Ver §7.
4. **IA sempre distinguível.** Conteúdo inferido leva o chip `INFERIDO POR IA · <provedor>` com ação `Regenerar`; arestas inferidas no grafo são tracejadas. Regra de produto, não estética (ADR-002).
5. **Movimento discreto e funcional.** 150–300 ms para UI; 20–28 s para imagens (Ken Burns). Nada pisca, nada gira sem motivo. Ver §9.

## 2. Shell da aplicação (padrão workspace)

Um projeto por vez. A sidebar serve ao projeto aberto; a troca de projeto é ato deliberado via combo.

```
┌────────────┬─────────────────────────────────────────────┐
│ Sidebar    │ Topbar 60px: breadcrumb · tema · Atividade  │
│ 270px      │              · Mapeamento · Sincronizar     │
│            ├─────────────────────────────────────────────┤
│ [Combo     │                                             │
│  WORKSPACE]│  Conteúdo da aba ativa                      │
│ PROJETO    │  max-width 1060px · padding 28px 32px       │
│ ENGENHARIA │                                             │
│ GOVERNANÇA │        (gaveta de atividade: 390px,         │
│            │         overlay à direita, sob a topbar)    │
│ [usuário]  │                                             │
└────────────┴─────────────────────────────────────────────┘
grid-template-columns: 270px 1fr;
```

- **Combo de workspace** (topo da sidebar): logo "P" 34px + rótulo mono `WORKSPACE` + nome do projeto. Dropdown lista `PROJETOS GERENCIADOS` (ponto de estado + no máx. 1 badge de alerta por item — o mais grave: `sem instalação` > `deploy divergente` > `deploy?` > `importar`) e rodapé `← Voltar ao catálogo`.
- **Navegação em grupos** (rótulos Mono caixa-alta): `PROJETO` (Visão Geral, Documentos, Kanban, Grafo, Decisões) · `ENGENHARIA` (Arquitetura, Skills & Agentes, Testes, Design, Deploy) · `GOVERNANÇA` (Contexto, Handoff). Item ativo: fundo `--card`, barra esquerda 2.5px `--accent`, ícone `--accent`.
- **Rodapé de usuário**: avatar + nome + e-mail; menu com Configurações e Sair.
- **Topbar**: breadcrumb `conta / projeto / aba` · toggle de tema · ações do projeto. Badge de origem do dado da aba ativa quando aplicável (`convenção` vs `INFERIDO POR IA`).
- **Catálogo** é página cheia (rota `/`), fora do shell de workspace — porta de entrada, com header próprio.
- **Rotas**: `/` (catálogo) · `/p/:projectId/:tab`. F5 e link direto preservam projeto/aba.

## 3. Tipografia

| Uso | Fonte | Peso | Tamanho |
|---|---|---|---|
| UI geral, corpo | `IBM Plex Sans` | 400 / 500 | 12.5–14 px |
| Títulos de página | `IBM Plex Sans` | 600 | 22–28 px, `letter-spacing: -0.01em` |
| Rótulos técnicos, seções, contadores, caminhos | `IBM Plex Mono` | 400–600 | 9–11 px, `letter-spacing: .11–.16em`, CAIXA ALTA |
| Código inline (labels `proplan:*`) | `IBM Plex Mono` | 400 | 11 px, chip com borda |

Regra: todo rótulo de **seção/estrutura** é Mono caixa-alta espaçado (`PROJETO`, `HISTÓRICO`, `BACKLOG`); todo **conteúdo** é Sans. Fontes **self-hosted** (`@fontsource/*`) — nunca CDN em runtime (ambiente 100% local).

## 4. Tokens de cor

CSS custom properties em `:root[data-theme]`. O tema troca **apenas** as variáveis — nenhum componente conhece cor absoluta.

### 4.1 Superfícies e texto

| Token | Carbono (padrão) | Claro | Uso |
|---|---|---|---|
| `--bg` | `#0c0d0f` | `#f2f2f0` | fundo da página |
| `--panel` | `#0e0f12` | `#fafaf8` | sidebar, topbar |
| `--surface` | `#131418` | `#ffffff` | cards, painéis |
| `--surface2` | `#16171b` | `#f6f6f4` | cards internos, inputs |
| `--card` | `#1c1e23` | `#eeeeec` | hover, ícones-chip, item ativo |
| `--colbg` | `#101114` | `#f0f0ee` | fundo de coluna Kanban |
| `--pop` | `#101114` | `#ffffff` | dropdown, gaveta, toast |
| `--border` | `#1e2025` | `#e5e5e1` | divisores |
| `--border2` | `#24262c` | `#dcdcd8` | borda de card/botão |
| `--border3` | `#2a2c33` | `#d3d3cf` | borda forte, tracejados |
| `--hoverb` | `#3a3d45` | `#b9b9b5` | borda em hover |
| `--text` | `#f5f4f1` | `#191a1d` | título |
| `--text2` | `#e8e7e3` | `#26272b` | texto de card |
| `--body` | `#b8b7b2` | `#3f4147` | parágrafo |
| `--body2` | `#c9c8c3` | `#33353a` | texto secundário |
| `--muted` | `#9a9da5` | `#5f6268` | apoio |
| `--faint` | `#8b8e96` | `#696c71` | rótulos mono |
| `--dim` | `#6c6f77` | `#8a8d93` | metadados |
| `--dimmer` | `#5d6068` | `#9a9da1` | placeholder |
| `--shadow` | `rgba(0,0,0,.5)` | `rgba(25,26,30,.16)` | sombras |

**Contraste da escala de apoio** (medido em 2026-07-16 contra o pior fundo de cada tema; §11 exige AA 4.5:1 para texto pequeno):

| token | Carbono | Claro | veredito |
|---|---|---|---|
| `--muted` | 7.06:1 | 5.46:1 | ✅ |
| `--faint` | 5.09:1 | 4.54:1 | ✅ — o Claro **era** `#74777d` (3.86:1) e foi escurecido |
| `--dim` | 3.32:1 | 2.86:1 | ❌ **reprova nos dois** — ver `STATUS.md` |
| `--dimmer` | 2.65:1 | 2.34:1 | n/a — **não é texto** |

- **`--dimmer` não carrega texto legível**: só ponto de estado, borda `/` de breadcrumb (`aria-hidden`) e item desabilitado — WCAG isenta controle desabilitado, e escurecê-lo apagaria a diferença entre "desabilitado" e "ativo", que é justamente o significado que ele comunica (§1).
- **Correção da tabela: `--dimmer` NÃO serve de placeholder** (o "uso" na linha acima é histórico). Medido: 2.85:1 no Carbono e 2.52:1 no Claro sobre `--surface2` — placeholder é texto que se lê e exige os mesmos 4.5:1 do corpo. **Placeholder usa `--muted`** (6.6:1 / 5.65:1).
- **`--dim` reprova e não tem correção barata**: empurrá-lo até 4.5:1 no Claro o faz colidir com `--faint` (ambos → `~#696c71`), e a escala de 4 níveis vira 2. Precisa de rebalanceamento da escala inteira, não de um valor — item no `STATUS.md`.

### 4.2 Acento e semânticas

| Token | Carbono | Claro | Significado |
|---|---|---|---|
| `--accent` | `#c9ced8` (prata) | `#5b616c` (aço) | marca, ativo, foco |
| `--accentSoft` | `rgba(201,206,216,.12)` | `rgba(91,97,108,.10)` | fundo de chip ativo |
| `--accentBorder` | `rgba(201,206,216,.35)` | `rgba(91,97,108,.35)` | borda de destaque |
| `--btnbg` / `--btnfg` | `#e2e5ea` / `#101114` | `#1f2126` / `#ffffff` | botão primário (Sincronizar, Entrar) |
| `--success` | `#4ade80` | `#15803d` | aceito, finalizado, sem custo |
| Azul (leitura/IA) | `#7ea6d8` | `#3f6aa5` | eventos de IA, coluna A Fazer |
| Violeta (escrita) | `#a596d8` | `#6b5aa8` | escrita no repositório, coluna Feito |
| Âmbar (andamento) | `#d9a05b` | `#96691c` | Em Andamento, prioridade média, alertas |
| Vermelho (alta/erro) | `#e08a80` | `#a33c31` | prioridade ALTA, falhas |
| Cinza-ardósia | `#8a90a0` | `#6b7280` | Backlog, neutro |

Gradiente da marca (logo "P", igual nos dois temas): `linear-gradient(135deg, #eceef2, #98a0ac); color: #16171b;`

### 4.3 Tintas por etapa do Kanban (fundo do **card**, não da coluna)

`background-color: var(--surface2)` + `background-image: linear-gradient(tinta, tinta)`:

| Etapa | Carbono | Claro |
|---|---|---|
| Backlog | `rgba(138,144,160,.10)` | `rgba(107,114,128,.09)` |
| A Fazer | `rgba(126,166,216,.10)` | `rgba(63,106,165,.09)` |
| Em Andamento | `rgba(217,160,91,.10)` | `rgba(150,105,28,.09)` |
| Feito | `rgba(165,150,216,.10)` | `rgba(107,90,168,.09)` |
| Finalizado | `rgba(74,222,128,.10)` | `rgba(21,128,61,.09)` |

Prioridade = **borda esquerda 3 px** no card: ALTA `#e08a80`/`#c65a4e`, MÉDIA `#d9a05b`/`#c29a4a`, BAIXA `#3a3d45`/`#c2c2be`.

## 5. Forma, espaçamento e elevação

- **Raios:** botões/inputs `9–10px` · cards `14–16px` · banners/hero `18px` · chips/pílulas `99px` · chips de código `6px`.
- **Espaço:** escala de 4 (4/8/12/16/20/24/28). Gap entre cards `12–16px`; padding de card `16–24px`.
- **Bordas antes de sombras:** todo card tem `1px solid var(--border2)`; sombra só em flutuantes (`0 24px 60px var(--shadow)` dropdown · `-28px 0 70px` gaveta · `0 20px 50px` toast).
- **Altura de controles:** botões topbar `34px` · botão primário grande `48px` · linhas de lista `~56px`.

## 6. Componentes

### Botões
- **Primário** (`Sincronizar`, `Entrar com GitHub`): `background var(--btnbg)`, texto `var(--btnfg)`, sem borda; hover `filter: brightness(1.08)`.
- **Fantasma**: transparente + `border var(--border2)`, texto `--body2`; hover muda só borda (`--hoverb`) e texto (`--text`).
- **Toggle Gerenciar/Gerenciado**: fantasma → ativo com fundo `--accentSoft`, borda `--accentBorder`, check e ponto verde.
- Press: escala 0.97; loading: spinner 14px no lugar do label com largura fixa (sem pulo de layout).

### Chips
- **Estado**: pílula `99px`, fundo semântico suave + texto na cor plena (`aguarda seu aceite` = accentSoft/accent; `aceito` = success).
- **Técnico** (`privado`, `PESSOAL`, prioridades): Mono 8.5px, caixa alta, `letter-spacing .06–.1em`.
- **IA**: contorno `--accentBorder`, texto `--accent`, rótulo `INFERIDO POR IA · <provedor>` — sempre acompanhado de `Regenerar`.

### Pílula de atividade (topbar) — o "sem silêncio"
- Ociosa: ponto verde pulsante + `Em dia · sync há 2 h`.
- Sincronizando: borda/fundo azulados, ponto na cor da etapa, texto Mono narra o passo atual.
- Escrita com gaveta fechada: badge verde com `popIn`.

### Gaveta de Atividade (390px, direita)
- `NESTA SINCRONIZAÇÃO`: passos com spinner (borda girando) → check verde; ativo `--text`, concluído `--muted`.
- `O QUE O PROPLAN FEZ NO SEU REPOSITÓRIO`: entradas com chip `ESCRITA` (violeta) / `IA` (azul) / `REUSO` (verde), borda esquerda 3px na mesma cor, meta Mono (tokens/custo) e link `ver no GitHub ↗`.

### Toast (canto inferior direito)
- `--pop` + borda `--border2` + **borda esquerda 3px** na cor semântica + ícone.
- Ciclo ~4.2 s numa única animação (`toastLife`); erro não auto-fecha. Título 12.5px 600 + subtexto 11px `--dim`. Máx. 3 empilhados. Política de uso: §8.

### Kanban (dnd-kit)
- 6 colunas fixas (`CONVENTION.md`): Backlog · A Fazer · Em Andamento · **Feito** · **Finalizado** · **Descartado**. **Feito é fila de aceite** — destaque de ação pendente do PI (contador âmbar quando > 0), não conquista. **Finalizado** é a conquista (verde). **Descartado** = trilho recolhido (34px, texto vertical Mono) — é decisão, não fracasso.
- Colunas `--colbg` neutras com header: ponto 8px na cor da etapa + rótulo Mono + contador (pílula na cor da etapa a 12–14%) + botão `+`. Coluna vazia: caixa tracejada `--border3`, texto `vazio`.
- **Card**: tinta da etapa + borda esquerda de prioridade + título 12.5px 500 + rodapé (chip prioridade · avatar 17px · `#issue` Mono). **Sem assignee = espaço vazio**, nunca placeholder — ausência deve ser *visível*, não decorada. Autor não é exibido. **Badge "sem dono"** (âmbar, discreto) em card **Em Andamento** sem assignee.
- Ao mover: estado otimista + borda pulsante até a Issues API confirmar (ADR-011) — toast só no resultado, nunca no gesto. Sem `STATUS.md` importado: banner de importação no topo.
- Drag: `DragOverlay` com o mesmo card + `rotate(2deg)`, sombra `0 24px 60px var(--shadow)`; drop target = coluna com borda `--accentBorder`.

### Grafo (react-flow)

> **Corrigido em 2026-07-16 (medido).** A versão anterior desta seção mandava nó `--surface` + borda `--border2` e aresta `--border3`. Contra o canvas isso dá **1.06:1** (nó) e **1.39:1** (aresta) no Carbono — invisível. **Nenhum token de superfície resolve**: a escala inteira fica em 1.04–1.79:1 contra `--bg`, porque foi desenhada para painéis empilhados, não para objetos soltos num canvas. Num canvas, quem separa é a **borda**, não o preenchimento.

- Nós = documento: `--card`, **borda `--muted` 1px** (7.17:1 carbono / 5.46:1 claro — o mínimo WCAG para componente gráfico é 3:1), raio 12px, sombra `0 4px 14px var(--shadow)` (o §5 permite em flutuante, e nó de grafo é flutuante por definição). Faixa esquerda 3px com a cor do tipo (README verde · CLAUDE.md azul · doc prata — todas ≥5:1 sobre o nó). Nó desatualizado ganha borda/ícone `--accent` (carbono) ou âmbar (claro).
- Nó-fantasma (link quebrado): tracejado `--error`, **sem preenchimento e sem sombra** — ele não é um documento que existe, e sombra sugeriria corpo (ADR-014: ausência é informação, nunca um bloco vermelho).
- Arestas: **`stroke: var(--dim)`** 1.5px (3.87:1 / 2.97:1) — `--dim` e não `--muted` de propósito: a aresta deve ler-se e continuar subordinada ao nó. Ativo/hover: `var(--accent)` com `stroke-dasharray: 4 8` animado. Hover destaca vizinhos e esmaece o resto. Arestas **inferidas por IA são tracejadas** (ADR-002).
- **Atmosfera** (`GraphAtmosphere`, decisão do PI em 2026-07-16 — substitui o `<Background dots>` do react-flow): o canvas era `--bg` chapado e o grafo boiava no vazio. **Carbono**: céu noturno — três camadas de estrelas em `radial-gradient` (poeira `--muted`, médias `--body`, brilhantes `--text`), tiles de tamanhos diferentes para não formar grade visível, mais um brilho de horizonte em `--accent` a 7% que ancora o campo. **Claro**: a bruma equivalente — partículas `--muted` a 55% (2.26:1) + duas massas de luz em diagonal a 16–22%; céu estrelado em tema claro leria como sujeira na tela. **Lição medida**: a primeira versão usava `--dim` a 30% (1.33:1) e o Claro ficava branco liso. O céu escuro funciona porque a estrela tem ~15:1 de espaço contra o preto; **no branco esse espaço não existe** — cinza claro sobre quase-branco não vai a lugar nenhum. Para a *mesma sutileza percebida*, o tema claro exige valores bem mais escuros. Os 2.26:1 são deliberados: ficam abaixo da aresta (2.97:1) para a atmosfera não competir com a informação. **Tudo em CSS** (zero asset) e **estático**: estrela piscando seria loop parado (§9) e as exceções já estão gastas — a profundidade vem das camadas, não de movimento. Fica **fora** do `<ReactFlow>`: é cenário fixo, não acompanha o pan/zoom. Custo aceito: a grade dava referência de deslocamento no pan; a atmosfera não dá.
- MiniMap: `--pop` + `--border2`, com nós em `--muted` (em miniatura o nó tem poucos pixels).

### Faixa de aba (hero das abas de documento)

Abas que renderizam um documento de convenção (Arquitetura, Decisões, Skills, Testes, Design, Deploy, Contexto…) abrem com uma **faixa hero** acima do conteúdo:

- Contêiner raio 18px, borda `--border`, imagem `workspace-vista*` do tema com **gradiente de leitura** + Ken Burns (regras do §10).
- **Ícone-chip** central (40px, fundo `--card`, borda `--border2`) ancorado na base da imagem, com o ícone da aba.
- Abaixo: título da aba (Sans 600) + descrição de valor em 1–2 linhas (para quem chega sem contexto: o que esta visão responde).
- **Rótulo Mono de estado**: `SINCRONIZADO DO REPOSITÓRIO · <quando>` quando o documento existe; quando **ausente**, o rótulo diz de qual arquivo a aba se alimenta (ex.: `AGUARDA docs/ARCHITECTURE.md`) — ausência é informação, não falha (ADR-014), então a faixa nunca usa cor de erro.
- Com documento presente, a faixa antecede o conteúdo renderizado; sem documento, a faixa **é** o empty state da aba (nada mais abaixo).

### Documentos
- Árvore: pastas com chevron rotacionando 90° (`.15s`), arquivos Mono 12.5px, badge `CONV`; selecionado = fundo `--card` + peso 600.
- Leitor: título + caminho Mono + chip de estado (`sincronizado` verde / `convenção` neutro / `desatualizado` acento) + alerta de drift em card suave.

### Visão Geral
- **Faixa de frescor** (ADR-010) no topo, acima de tudo: `Docs: há X · Código: há Y`. Dentro do limiar → `--surface` + `--muted`, sem ícone. Acima → fundo âmbar 10%, borda âmbar 30%, ⚠️ "Documentação possivelmente defasada" + tooltip do cálculo. **Nunca vermelha**, nunca bloqueia conteúdo. Entrada: fade, sem slide.
- Blocos "O que é / Onde parou / O que falta" com chip IA + `Regenerar`.

### Deploy
- Tabela de ambientes idêntica ao formato do `DEPLOY.md` — renderização direta, sem transformação.

## 7. Operações assíncronas (SPEC-010)

Toda escrita do ProPlan no repo (`ação → commit → propagação → sync → recarregar`) leva segundos. **Silêncio nesse intervalo é bug.**

- **Passos nomeados, em linguagem de gente**: `Commitando docs/ARCHITECTURE.md…` → `Aguardando o GitHub propagar…` → `Sincronizando…` → `Pronto`. Nunca jargão (`202`, `docsTreeSha`).
- **A tela nunca fica igual e muda.** Se algo está acontecendo, aparece (pílula → gaveta → toast).
- **Falha é um passo que falha**, com motivo e ação (`Tentar de novo` / `Resolver no repo`) — nunca um toast que some.
- **A operação sobrevive à navegação**: progresso segue visível na gaveta de Atividade.
- **Estado mora no servidor**: F5 no meio volta mostrando o passo atual.

## 8. Política de toasts

**Toast comunica resultado do que o usuário não está vendo; estado inline comunica o que ele está vendo.**

| Evento | Feedback |
|---|---|
| Mover card (otimista) | Inline: borda pulsante no card — sem toast |
| Commit confirmado pelo webhook | Toast success "Alterações salvas no repo" |
| Falha/conflito de commit | Toast error persistente (não auto-fecha) com ação "Resolver" |
| Sync concluído em background | Toast info com resumo ("3 docs atualizados") |
| Bootstrap IA pronto para revisão | Toast com ação "Revisar proposta" |
| Trocar aba, filtrar, colapsar | Nada — a própria UI é o feedback |

Racional: toast em toda ação treina o usuário a ignorá-los e mascara o canal quando um erro real aparece.

## 9. Movimento

```css
@keyframes fadeUp   { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
@keyframes dropIn   { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:none; } }
@keyframes drawerIn { from { transform:translateX(102%); } to { transform:none; } }        /* .3s cubic-bezier(.2,.8,.2,1) */
@keyframes stepIn   { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:none; } }
@keyframes popIn    { from { opacity:0; transform:scale(.5); } to { opacity:1; transform:scale(1); } }
@keyframes toastLife{ 0%{opacity:0;transform:translateY(16px) scale(.96);} 8%{opacity:1;transform:none;} 86%{opacity:1;} 100%{opacity:0;transform:translateY(10px);} } /* 4.2s */
@keyframes actPulse { 0%,100%{ box-shadow:0 0 0 0 var(--pulse, rgba(74,222,128,.4)); } 70%{ box-shadow:0 0 0 7px transparent; } }
@keyframes spin     { to { transform:rotate(360deg); } }                                    /* spinner .7s linear */
@keyframes heroZoom { from { transform:scale(1); } to { transform:scale(1.12); } }          /* imagens, 20–28s */
```

- Entradas de página: `fadeUp` escalonado (delays 0/.05/.1/.15/.2 s), só na primeira montagem — refetch não re-anima.
- Hovers: `transition: .15s ease` em borda/cor; cards do Kanban sobem 1px.
- Skeletons (não spinners) em toda carga de aba, shimmer 1.5s.
- **Regra de ouro**: efeito responde a ação do usuário ou mudança de estado; nada anima em loop parado (exceções: pulso de atividade, Ken Burns de imagem e o carrossel do Login — ver abaixo).
- **Exceção registrada — carrossel de valor do Login** (decisão do PI em 2026-07-16, Fatia 16): as 4 mensagens do hero rotacionam sozinhas a cada 4.5 s. É loop parado, contra a regra de ouro; vale porque a tela é pré-autenticação — não é ferramenta de gestão ainda, é a única chance de dizer o que o produto entrega a quem não entrou. **Escopo estrito**: só o Login. Para sob `prefers-reduced-motion`, e **para de vez** quando o usuário clica num dot (mexer no controle é dizer "eu dirijo agora"). Nenhuma tela autenticada ganha carrossel.
- **Limites**: sem parallax, sem scroll-jacking, sem gradientes animados de fundo, sem confete. Densidade de informação primeiro — é ferramenta de gestão, não landing page.
- Animar apenas `transform`/`opacity`; nunca `width/height/top` em listas grandes. Framer Motion para orquestração; CSS puro para hover/focus/press.

## 10. Imagens (IA)

Estilo único: **render 3D abstrato, vidro fosco prata sobre grafite (ou marfim no claro), monocromático, sem texto, um único acento verde**, luz volumétrica da esquerda, profundidade de campo rasa, muito espaço negativo.

| Asset | Uso | Tema |
|---|---|---|
| `hero-grafo.jpg` / `hero-grafo-claro.png` | hero do login | carbono / claro |
| `catalogo-banner.png` / `catalogo-banner-claro.jpg` | banner do catálogo | carbono / claro |
| `workspace-vista.png` / `workspace-vista-claro.png` | faixa de aba (hero/empty state das abas de documento, §6) | carbono / claro |

- Sempre em contêiner raio 18px, `border var(--border)`, **gradiente de leitura** por cima.
- **Ken Burns** contínuo: `heroZoom 20–28s ease-in-out infinite alternate` (estático sob `prefers-reduced-motion`).
- Em React, `background-image` com URL vinda do estado do tema (nunca `<img src>` tardio).
- Prompt-base (ajustar sujeito): *"Premium dark abstract 3D render… deep graphite charcoal background (#0c0d0f), frosted-glass [sujeito] connected by thin glowing silver lines, one small green accent, strictly monochrome silver/graphite palette, soft volumetric light from the left, shallow depth of field, enterprise SaaS aesthetic, no text, no logos, generous negative space"*.

## 11. Acessibilidade

- Contraste AA nos dois temas (texto ≥ `--muted` sobre `--surface`).
- Foco visível universal: `outline: 2px solid var(--accent)` — nunca remover sem substituto.
- Toasts anunciados via `aria-live="polite"`; fechar modal/gaveta com Esc sempre.
- Tudo atrás de `prefers-reduced-motion`: transições instantâneas (opacity ainda permitida).

## 12. Implementação (estado atual do repo)

```tsx
// ThemeProvider: data-theme no <html>
<html data-theme="carbono">
:root[data-theme="carbono"] { --bg:#0c0d0f; /* …tabelas §4 */ }
:root[data-theme="claro"]   { --bg:#f2f2f0; /* … */ }
```

- Componentes usam **somente** `var(--token)` (via utilitários Tailwind mapeados em `@theme` para as custom properties). Cores semânticas do Kanban/atividade via mapa TS `stageTint(theme, stage)`.
- **Tokens vivem em `apps/web/src`** (`tokens.css` + `stageTint.ts`) enquanto houver um único consumidor; extrair para `libs/ui-tokens` só quando surgir o segundo (decisão SPEC-020 — o design de referência sugeria a lib desde já; YAGNI venceu).
- **Tema persistido em `localStorage`** — dívida registrada na SPEC-020: migrar para preferências via API quando existir uma segunda preferência de usuário.
- **Atividade**: o backend emite eventos (`sync.step`, `repo.write`, `ia.call`, `ia.reuse`) → pílula/gaveta/toast apenas renderizam o stream. Toda escrita no repo gera evento com `url` do GitHub (SPEC-010).
- **Kanban**: mover para *Finalizado* é bloqueado no cliente e no servidor para não-donos (aceite humano, ADR-011).
- Base de componentes: shadcn/ui (Tabs, Dialog, Badge, Sonner) + dnd-kit + react-flow + Framer Motion. Sem biblioteca de UI pesada por cima.
