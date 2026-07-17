# Verificação ao vivo — entregas aceitas atrás do OAuth

> **Por que este documento existe.** As entregas abaixo foram aceitas (foram direto para *Finalizado*) com CI verde, `tsc`, builds e testes de tela passando — mas **nunca exercitadas ponta a ponta com o GitHub App logado**. Cada `DEVELOPMENT.md` marcou "Verificação ao vivo pendente (atrás do OAuth)". Este é o roteiro que quita essa dívida. É o mesmo tipo de "verde que não prova o que diz provar" que a #74 já pegou uma vez.
>
> Marque cada item **você** (PI), rodando o painel real. Falhou → abre item no `STATUS.md` (correção de bug documentado não precisa de spec).

## Pré-requisitos

- [ ] `pnpm dev` sobe infra + API (`3311`) + web (`5180`) — containers `Healthy`.
- [ ] Login pelo GitHub App concluído; ≥1 projeto gerenciado; de preferência **1 repo público** e **1 privado** (o privado exercita fallbacks).
- [ ] Testar nos **dois temas** (Carbono e Claro) onde indicado.

---

## 1. SPEC-020 — Shell workspace + temas

- [ ] Abrir o painel com ≥1 projeto gerenciado cai no catálogo (`/`); abrir um projeto leva a `/p/:id/overview` com sidebar de grupos e combo com o nome do projeto.
- [ ] O combo lista todos os gerenciados com ponto de estado; projeto com **App removido** mostra badge `sem instalação` no item.
- [ ] Trocar de projeto pelo combo carrega o outro workspace **sem passar pelo catálogo**; `← Voltar ao catálogo` leva a `/`.
- [ ] **F5 em `/p/:id/kanban`** volta ao mesmo projeto e aba.
- [ ] Toggle de tema alterna Carbono ↔ Claro em **toda** a UI **sem reload**; sobrevive a F5 (localStorage).
- [ ] **Inspeção visual das 12 abas nos 2 temas** — nenhum componente com cor do tema errado (este é o item que teste de tela não cobre).
- [ ] `Sincronizar`, `Atividade` e `Mapeamento` funcionam como antes; painel de atividade abre ao fim do sync.
- [ ] Kanban e Grafo: drag & drop e seleção de nó sem regressão; tintas por etapa/nó conforme DESIGN.md.
- [ ] Aba com doc presente mostra a faixa hero `SINCRONIZADO DO REPOSITÓRIO · <quando>`; aba sem doc mostra empty state `AGUARDA <arquivo>` — nos 2 temas, **sem cor de erro**.
- [ ] Foco visível (`outline` acento) em todos os controles interativos (navegar por Tab).

## 2. SPEC-021 — Login e Catálogo

- [ ] Login renderiza nos 2 temas com hero animado; **estático sob `prefers-reduced-motion`** (ativar no SO/DevTools e recarregar).
- [ ] `Entrar com GitHub` completa o OAuth como antes.
- [ ] Catálogo em página cheia: **gerenciar** um repo cria o projeto e o card passa a oferecer `Abrir workspace` → `/p/:id/overview`.
- [ ] `✓ Gerenciado` **desgerencia com diálogo de confirmação**; o diálogo deixa claro que **só o índice local é removido, o repo não é tocado**.
- [ ] Remover o gerenciamento de um projeto **aberto em outra aba** não quebra o workspace — recarregar cai no 404 amigável da SPEC-020.
- [ ] Imagens servidas localmente (sem CDN); o gradiente de leitura muda por tema (carbono escurece, claro clareia).
- [ ] Estado vazio (App em nenhum repo) aparece re-estilizado.

## 3. Fix — contraste `--dim` (AA nos dois temas)

- [ ] Timestamps, contadores, `@login`, breadcrumb e o **rótulo vertical da coluna** legíveis nos 2 temas — o defeito era 3.32:1 (Carbono) / 2.86:1 (Claro), abaixo do mínimo AA 4.5:1.
- [ ] A **aresta do Grafo, o chevron e o ponto de coluna** (não-texto) continuam subordinados ao nó — `--dim` só ficou para não-texto; não engrossou nem sumiu.
- [ ] Conferir que `--faint` (texto de metadado) e a aresta não colidiram na mesma tinta.

## 4. Fix — card do Kanban mostra data/hora

- [ ] Colunas abertas (Backlog · A Fazer · Em Andamento · Feito): card mostra **`aberta em dd/MM/aaaa às hh:mm`** (24h).
- [ ] Coluna **Finalizado**: mostra `finalizado em …`; **Descartado**: `descartado em …`.
- [ ] Card encerrado **sem `closedAt`** cai na data de criação — **nunca fica mudo nem inventa data**.
- [ ] Cards do import legado (#9, #8, #4) mostram `13/07/2026 às 00:00` até o **próximo sync do board** — depois assumem o `created_at` real do GitHub (backfill honesto, não `now()`).
- [ ] Meia-noite não vira `24:xx` (checar um card criado 00:xx, se houver).

## 5. Fix — gaveta de Atividade fecha sozinha 4s após o sync

- [ ] Rodar `Sincronizar`: a gaveta **abre no fim do sync** e **fecha sozinha ~4s depois** (como toast).
- [ ] **Hover / scroll / clique / foco** dentro da gaveta **reinicia a contagem** — não fecha enquanto você lê.
- [ ] Com **job de IA em curso**, a gaveta **não fecha no meio** (o polling de 2s adia o auto-close).
- [ ] Abrir a gaveta **pela pílula** (não pelo sync) **nunca auto-fecha** — é intenção de ler.

---

## Encerramento

- [ ] Todos os itens acima verdes → registrar no `DEVELOPMENT.md` que a "verificação ao vivo pendente" foi quitada (remover a ressalva das entregas correspondentes).
- [ ] Qualquer item vermelho → item no `STATUS.md` + regra escrita; se o comportamento correto já está numa spec/ADR/`DESIGN.md`, é correção de bug documentado (sem spec). Se o certo não está definido, decisão do PI antes de corrigir.
