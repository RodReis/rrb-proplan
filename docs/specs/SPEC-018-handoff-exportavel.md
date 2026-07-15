---
proplan: v1
spec: SPEC-018
fatia: 13.5
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-15 (5 decisões do PI incorporadas)
updated: 2026-07-15
---
# SPEC-018 — Fatia 13.5: Handoff exportável (o instantâneo que se leva embora)

> **O *output* do produto** (MVP2 §6). Congela o modelo de retomada num pacote de contexto que um humano ou um agente leva embora — estado atual + próxima ação + arquivos a ler + DoD + testes + **restrições (o que não mexer)** + **confiança de cada bloco**. Desmembrada da Fatia 13 em 2026-07-14: a 13 confronta fontes de deploy; esta empacota o contexto todo.

## O que distingue do MCP (Fatia 11) — não é a mesma coisa duas vezes

| | MCP (Fatia 11, SPEC-016) | Handoff exportável (esta fatia) |
|---|---|---|
| forma | servidor vivo, consultado sob demanda | **artefato congelado**, um instantâneo datado |
| consumidor | agente, na sessão, com os dois MCPs conectados | humano **ou** agente que **não tem** o ProPlan aberto |
| granularidade | responde uma das 6 perguntas por vez | o pacote **inteiro** de uma vez |
| frescor | serve o cache do ProPlan (foto), o agente age | **assume** que está velho no instante em que sai — e diz isso |

São a mesma matéria-prima (o modelo canônico da Fatia 9) por duas superfícies. **A montagem do handoff é uma só** — ver Notas técnicas e PA-5. O que muda é o invólucro: o MCP entrega fatias vivas; o export entrega o bloco todo, frio, com data de validade impressa na testa.

## Objetivo

Renderizar o modelo canônico (Fatia 9) num **documento de handoff** — legível por humano, parseável por agente — em que **cada bloco carrega sua proveniência, sua confiança e a conta**, e **bloco abaixo do limiar recusa** ("não sei — ausente/defasado" + o que falta) em vez de chutar. É o corolário do MVP2 materializado num artefato portátil: *um handoff que sabe recusar vale mais que um que sempre responde; o modo de falha que mata o produto é a linha confiante e errada num documento que alguém vai seguir sem checar.*

## A tensão central desta fatia (ADR-017 × "levar embora")

O ADR-017 lista `handoff` como **julgamento → expor, é o produto** — sancionado. Mas o mesmo ADR impõe o corolário: **as saídas do ProPlan referenciam a issue (número + URL), nunca a reproduzem** — porque nosso cache é foto e o GitHub está sempre mais fresco. Um handoff **congelado e portátil** leva essa tensão ao extremo: quem o lê offline **não tem** o GitHub à mão para seguir o link. Congelar o pacote é o propósito da fatia; congelar o estado de issue/PR/check seria virar "a segunda fonte de um fato que o GitHub serve ao vivo" — exatamente o que o ADR-017 proíbe. **Como o handoff cita o backlog e o "último estado" (#6, #7 do modelo) sem reproduzi-los é a decisão que bloqueia esta spec** (PA-3).

## Escopo

1. **Montagem do handoff (`assembleHandoff`)** — projeção de leitura pura sobre o modelo canônico da Fatia 9 (`getCanonicalModel`) + board (Fatia 5) + resolver (Fatia 6) + constraints da Fatia 10 **quando existir**. Produz a estrutura de handoff: para cada bloco, `{ valor | recusa, proveniência, confiança, conta }`. **Zero IA no caminho** (ADR-002) — o número vem do cálculo determinístico da Fatia 9, o texto vem do que já está persistido. Não re-deriva nada que os domínios anteriores já calculam (ADR-001: consome por interface pública).
2. **Blocos do pacote** (MVP2 §6), na ordem de retomada:
   - **Projeto + objetivo** — `fato` do `README.md`/`CLAUDE.md` (canônico).
   - **Arquitetura + módulos** — `fato`/`inferência` (canônico; inferência carrega spans, ADR-012).
   - **Decisões/ADRs** — `fato` (canônico).
   - **Backlog + último estado** — **referência** às issues (número + URL), datada; **nunca o corpo** (ADR-017 / PA-3).
   - **Próxima ação recomendada** — derivada (board + canônico); **sem IA** enquanto a Fatia 11 não existir → slot honesto (PA-1).
   - **Arquivos a ler + DoD + testes** — do `DocumentResolver` (Fatia 6) + doc + workflows.
   - **Restrições (o que não mexer)** — asserção humana da Fatia 10, **com a marca `a-revalidar` sempre propagada** (ADR-013) → o fosso; slot honesto se a 10 não existir (PA-1).
   - **Confiança por bloco + a conta** — de cada campo canônico, clicável na UI, inline no markdown.
3. **Renderizador markdown (`renderHandoffMarkdown`)** — serializa a estrutura em markdown legível. Bloco recusado vira uma seção explícita *"não sei — ausente/defasado · falta: …"*, **nunca é omitido** (a ausência honesta é o produto). Cada bloco imprime `proveniência · data · confiança (a conta)`.
4. **Cabeçalho de validade** — o documento abre com `gerado em <data> · docsScopeHash <hash> · este é um instantâneo; o estado vivo está no GitHub`. É o que impede o handoff de mentir por frescor.
5. **Entrega** — como o artefato chega à mão do dono (PA-2): download na UI e/ou write-back em `.proplan/HANDOFF.md` (**nunca** em `docs/` — mascararia o ADR-010).
6. **UX na aba correspondente** — botão "Exportar handoff" com preview antes de baixar/commitar; a confiança de cada bloco é clicável (reusa o padrão da Fatia 9).

## Fora de escopo (explícito)

- **Reproduzir corpo de issue / estado de PR / resultado de check** (ADR-017). O handoff **referencia**; o detalhe vivo está na fonte. (Como referenciar sem deixar o leitor offline cego → PA-3.)
- **Qualquer chamada de IA no caminho de exportação** (ADR-002/ADR-016). A "próxima ação" não é gerada por LLM nesta fatia — é derivada ou slot. Se um dia virar inferência, é fatia própria sob o teto da SPEC-009.
- **Reimplementar o julgamento** — confiança, drift, resolução e proveniência já moram nas Fatias 9/6/13. Esta fatia **compõe e serializa**, não recalcula (ADR-001). Lógica de julgamento **nova** aqui é cheiro de arquitetura.
- **Importar handoff de volta / round-trip** — o export é de mão única. Reingerir um handoff editado seria outra fatia (e provavelmente uma má ideia: o repo é a fonte, não o pacote).
- **Renomear/mover/reescrever documento do repo-alvo** (ADR-014). Escrever `.proplan/HANDOFF.md` é artefato do ProPlan, não conteúdo humano — permitido; tocar `docs/` não.
- **Formato PDF/outros** — markdown é o formato canônico do handoff (consumível por humano e agente). Outros formatos, se pedidos, depois.

## Contratos

- **Domínio puro e testável** (`handoff/domain/` — módulo novo candidato, decisão do Code; ou dentro de `canonical`):
  ```ts
  assembleHandoff(input): Handoff              // projeção de leitura pura, sem IA
  renderHandoffMarkdown(h: Handoff): string    // serialização determinística
  ```
  `Handoff` = lista ordenada de blocos; cada bloco = `{ titulo, valor | recusa, proveniencia, confidence, math, refs? }`. `refs` = issues por `{ numero, url, titulo?, capturadoEm }` — **sem corpo** (ADR-017; `titulo?` sujeito à PA-3).
- **API**: `GET /projects/:id/handoff` → a estrutura montada (ou o markdown, conforme PA-2). Sem IA no caminho (ADR-002; verificável: não cria linha em `LlmUsage`). Se houver write-back: `POST /projects/:id/handoff/commit` reusando o write-back compartilhado (identidade `proplan[bot]`, ADR-015) — sujeito a PA-2.
- **Prisma**: **nenhum modelo novo** se a entrega for download puro (o handoff é derivado do canônico no render). Se o PI pedir instantâneos versionados no banco (PA-2), aí sim uma tabela append-only entra — mas a recomendação é **não** (o git já versiona `.proplan/HANDOFF.md`; um instantâneo é foto, não estado).
- **Reuso pela Fatia 11**: `assembleHandoff` é a fonte única que o `get_handoff_context` do MCP (SPEC-016) vai consumir — a SPEC-016 já declara "adaptador, não reimplementação". Ver PA-5.

## Critérios de aceite

- [ ] O handoff traz **todos** os blocos do MVP2 §6, cada um com proveniência + confiança + a conta; **nenhum** bloco aparece como score uniforme sem procedência.
- [ ] Bloco abaixo do limiar (Fatia 9, `Settings`, padrão 0.4) → seção **"não sei — ausente/defasado · falta: …"**, nunca um palpite; e **não** é omitido.
- [ ] Restrições da Fatia 10 aparecem com a marca **`a-revalidar` sempre presente** quando aplicável; um teste prova que a marca nunca é omitida (ADR-013). *(Se a 10 não estiver entregue — PA-1 — o bloco recusa honestamente em vez de sumir.)*
- [ ] Backlog e "último estado" **referenciam** issues por número+URL, **sem reproduzir corpo/estado** — revisão contra o ADR-017 é critério de aceite.
- [ ] O cabeçalho de validade (`gerado em · docsScopeHash · instantâneo, estado vivo no GitHub`) está presente em todo export.
- [ ] **Zero IA** no caminho de exportação (não cria `LlmUsage`); determinístico: mesmo `docsScopeHash` → mesmo markdown (teste de fixture, não "avaliação").
- [ ] O export **nunca** entra em `docs/` (teste de arquitetura, como a projeção `.proplan/STATUS.md` da Fatia 5) — se houver write-back, é `.proplan/HANDOFF.md`.
- [ ] `assembleHandoff` não importa entidade interna de `canonical`/`board`/`context` — consome por interface pública (ADR-001).

## Notas técnicas

- **Uma montagem, duas superfícies**: `assembleHandoff` é o mesmo domínio que o `get_handoff_context` da Fatia 11 vai servir. Construí-lo aqui como domínio compartilhado (não "export-only") evita que a 11 o reimplemente — coerente com a nota "adaptador, não reimplementação" da SPEC-016 e com o ADR-001. É o argumento a favor de sequenciar esta fatia **antes** da 11 (PA-5), ou ao menos de a 11 herdar este domínio.
- **Determinismo**: o markdown é serialização pura da estrutura canônica; ordenar blocos e campos por chave estável garante que o mesmo `docsScopeHash` produza bytes idênticos — o que torna o "diff de handoff entre dois instantâneos" um subproduto de graça (git faz sozinho se for `.proplan/HANDOFF.md`).
- **`próxima ação` sem IA**: enquanto a Fatia 11 não deriva a recomendação rica, a "próxima ação" honesta é *"próximo card em A Fazer: #N (link)"* — derivada do board, referência pura, zero IA. Não inventar prioridade que o board não expressa.
- **Octokit é ESM-only** (CLAUDE.md) — se o commit do handoff precisar de chamada GitHub, usar o write-back `fetch` compartilhado já existente, não reintroduzir Octokit.
- **Custo de renderizar 2× o mesmo conteúdo**: se a UI mostra o preview e o `.proplan/HANDOFF.md` guarda o mesmo texto, há duplicação — aceitável (é o mesmo princípio já aceito na SPEC-012 para o doc de Deploy). Esconder do dono o que ele vai levar embora seria pior.

## Decisões do PI (2026-07-15) — nenhuma pergunta aberta

1. **Entregar já sobre a Fatia 9** — os blocos que dependem das Fatias 10 (restrições) e 11 (próxima ação rica) **recusam honestamente** ("ausente") até elas entregarem; viram reais sem retrabalho. A recusa honesta é on-tese; não se segura o output do produto por causa de bloco ainda vazio. *(Sequência: 13.5 pode ir antes da 11 — reforçado pela Decisão 5.)*
2. **Entrega: download + write-back, arquivo único `.proplan/HANDOFF.md`, sem tabela Prisma.** Download para levar embora agora; write-back (`proplan[bot]`, ADR-015) para deixar o instantâneo versionado — o **git** dá o histórico, não uma tabela. **Nunca `docs/`** (ADR-010). Sem timestamped: sobrescreve, e o git versiona cada export.
3. **ADR-017 no portátil: referência + título da issue datado, com caveat "estado no momento da exportação — verifique na fonte".** Título é rótulo, não o fato vivo que o GitHub serve — pode entrar datado. **Corpo de issue, estado de PR e resultado de check ficam sempre de fora.** É onde "portátil" e "não sou a segunda fonte" coexistem.
4. **Evidência no markdown: leve no corpo, `sha` no rodapé de proveniência.** Corpo mostra `classe · fonte (path linkada ao GitHub) · data · confiança (a conta)`; `sha` (e futura `linha`) vão para um rodapé — auditável sem poluir cada bloco.
5. **`assembleHandoff` construído como domínio compartilhado agora** (`handoff/domain/`), antecipando a Fatia 11 — o `get_handoff_context` da SPEC-016 herda ("adaptador, não reimplementação"; ADR-001). Reforça sequenciar a 13.5 **antes** da 11.
