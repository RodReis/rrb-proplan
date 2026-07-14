---
proplan: v1
spec: SPEC-005
fatia: 5
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-005 — Kanban: gestão visual sobre GitHub Issues

> **Reescrita (2026-07-12).** A versão anterior era construída sobre o ADR-005 (`STATUS.md` como fonte de verdade). O PI decidiu **antecipar o ADR-011** para esta fatia: Issues passam a ser a fonte de estado e `STATUS.md` vira **projeção gerada**. O histórico da versão anterior está no git.

## Objetivo

Gerir o andamento do projeto movendo cards, com o **GitHub Issues** como dono do estado — e o repositório continuando legível e auditável, porque o ProPlan gera e commita `.proplan/STATUS.md` como retrato versionado desse estado (ADR-011).

## Decisão de mapeamento (por que labels)

Issue tem só `open`/`closed`. As quatro colunas da convenção precisam morar em algum lugar:

- **Escolhido — labels `proplan:*`**: `proplan:backlog|todo|doing|done` (todas com a issue **`open`**) + `proplan:finalizado|descartado` (com a issue `closed`). Issue aberta e gerenciada **sem** label `proplan:*` cai em `Backlog` por padrão. REST puro, funciona em qualquer repo com Issues habilitada, e é reversível (apagar as labels devolve o repo ao estado original).
- **Rejeitado no MVP — GitHub Projects v2**: campo `Status` nativo, ordenação manual e views prontas — mas exige GraphQL, exige um Project criado e configurado por repo, e acopla o Kanban à forma como cada projeto usa Projects. Reavaliar no MVP2, quando a ordenação manual e sub-issues entrarem em pauta.

## Escopo

### Módulo `board` (novo)

- **Leitura**: `GET /repos/{o}/{r}/issues?state=all&labels=…` (paginado). Cada issue vira um card; a coluna sai do estado + label `proplan:*` (aberta com `proplan:done` → Feito; `closed` + `proplan:finalizado` → Finalizado; `closed` sem label → Finalizado com badge "fechada fora do ProPlan"). `pull_request` presente no payload ⇒ **é PR, não issue** → descartar (armadilha clássica da REST API).
- **Mutações** (todas viram chamada à Issues API, não commit):

  | ação | chamada |
  |---|---|
  | mover entre colunas abertas | trocar label `proplan:*` |
  | mover para **Feito** | trocar label → `proplan:done`. **A issue continua `open`** |
  | mover para **Finalizado** | `PATCH state=closed` + label `proplan:finalizado` (+ comentário de carimbo) |
  | tirar de Finalizado/Descartado | `PATCH state=open` + aplicar a label da coluna destino |
  | criar card | `POST /issues` (título + label da coluna) |
  | editar título/prioridade | `PATCH /issues/{n}` (título; prioridade = label `prio:alta\|media\|baixa`) |
  | atribuir / desatribuir | `PATCH /issues/{n}` com `assignees` (**no máximo um** — ver abaixo) |
  | descartar card | `PATCH state=closed` + label `proplan:descartado` — **nunca deletar issue** (a API de delete existe mas é destrutiva e irreversível; não damos esse poder ao board) |

- **Identidade do card = `issue.number`.** Estável. Some a gambiarra de identificar card por `coluna + índice + hash do texto`.
- **Granularidade: `card = fatia`** (ADR-011, decisão do PI em 2026-07-13). **Uma issue por fatia**, não por sub-item. Motivo: o `DEVELOPMENT.md` também rastreia estado (checkmarks por passo); card na granularidade do sub-item colocaria **o mesmo fato em dois lugares**. Issues respondem *"qual fatia está em qual coluna"*; o `DEVELOPMENT.md` responde *"onde estou dentro da fatia"*. Granularidades diferentes ⇒ sobreposição zero.
- **Seis colunas** (a convenção v1 tinha quatro). Mapeamento **corrigido em 2026-07-13** (ADR-011):

  | coluna | estado da issue | significado |
  |---|---|---|
  | Backlog · A Fazer · Em Andamento | `open` + `proplan:backlog\|todo\|doing` | — |
  | **Feito** | **`open`** + `proplan:done` | entregue — **aguardando aceite do dono** |
  | **Finalizado** | `closed` + `proplan:finalizado` | **aceito** |
  | **Descartado** | `closed` + `proplan:descartado` | decisão de não fazer |

  **A issue só fecha quando o trabalho realmente acabou.** Fechar é ato deliberado do dono, nunca efeito colateral de merge.

  **`Feito` era `closed` na versão anterior — estava errado.** O motivo do erro era automação barata (`closes #42` fecha a issue no merge ⇒ card cai em Feito sozinho, zero código). O defeito: trabalho **entregue e não aceito** apareceria **fechado no GitHub** — e o ProPlan **não é o único leitor** (ADR-017: o GitHub MCP serve issues a agentes). Um agente perguntando *"o que está aberto?"* não veria o item pendente e concluiria que está tudo resolvido. É o **"fechamento frágil"** que o MVP2 promete detectar: o produto estava fabricando o defeito que existe para caçar.

  **`closes #N` fica proibido no nosso processo** (usar `refs #N` — `CLAUDE.md`): senão o merge fecharia a issue e **forjaria o aceite**.

  **Feito é uma fila com dono**: mostra o que está esperando aceite. Não é badge, é estágio de fluxo.

  Reabrir (de Finalizado/Descartado) = arrastar para uma coluna aberta: reabre a issue e remove a label.

- **Assignee (emenda de 2026-07-13)** — **um só**, exibido no card.

  **Por que assignee sim e autor não**: o **autor** é sempre `proplan[bot]` ou o próprio PI — um avatar idêntico em 100% dos cards **não informa nada** e polui o card. Já o **assignee** passa a valer no momento em que existe mais de um executor — e isso está chegando: o **GitHub Copilot coding agent pode ser atribuído a uma issue**. Com PI + agente(s) trabalhando em paralelo, "quem está tocando esta fatia" vira a informação mais útil do board, e **Em Andamento** vira um mapa de alocação.

  - Exibição: avatar pequeno no rodapé do card. **Sem assignee = espaço vazio**, não um placeholder cinza — ausência tem que ser *visível*, não decorada.
  - **Múltiplos assignees continuam fora de escopo** (complexidade de UI sem caso de uso). Se a issue vier do GitHub com N assignees, o card mostra o **primeiro** e um `+N` discreto; editar pelo ProPlan **substitui** por um só.
  - **Badge "sem dono"**: card em **Em Andamento** sem assignee ganha um badge âmbar discreto. É trabalho em curso sem responsável — a semente exata do "projeto esquecido" (regra do MVP2). Sinal barato, pega problema real.

- **Carimbo de aceite/descarte via comentário na issue**: `closed_at` marca a **entrega**, não o **aceite**, e a data de aplicação de label não é recuperável barato. Ao mover para **Finalizado** ou **Descartado**, o ProPlan **posta um comentário**: `proplan: finalizado pelo PI em <data>` / `proplan: descartado em <data>`. Permanente, auditável, no GitHub — **evidência**, não cache. Mover de volta **não apaga** o comentário (o histórico é o produto).
- **Projeção `.proplan/STATUS.md`** (raiz do repo-alvo, **fora de `docs/`** — ver "Separação `docs/` × `.proplan/`" nas notas técnicas): gerada pelo ProPlan a partir das issues e commitada. Cabeçalho obrigatório:

  ```markdown
  <!-- gerado pelo ProPlan a partir das Issues — não edite à mão -->
  ```

  - Gatilho: após cada mutação confirmada **e** ao final de cada `sync-job` cujo estado de issues mudou. Debounce por projeto (janela curta) para não gerar um commit por card arrastado.
  - Mensagem: `proplan: atualiza STATUS.md (projeção das Issues)`.
  - Cada card na projeção carrega o link e o número da issue: `- Tela de configurações (#42, prio: alta)`. Finalizado/Descartado usam o `closed_at` real da issue — **fato**, não carimbo nosso. **Feito não tem data** (a issue ainda está aberta).
  - Escrita **de fora para dentro**: o ProPlan gera o arquivo inteiro a cada vez. **Não há round-trip fiel** — o arquivo é artefato de build, não documento humano. Isso elimina o requisito mais caro da spec anterior.
  - Edição manual é **sobrescrita** na próxima projeção. A UI avisa quando detecta divergência.

- **Reconciliação sem webhook (ADR-009)**: re-sync automático após cada mutação confirmada; botão Sincronizar cobre mudanças feitas direto no GitHub.
- **Serialização por projeto**: mutações entram na fila BullMQ `board`, processadas em ordem. Concorrência de *cards* deixa de ser problema (a Issues API resolve); a fila existe agora para **serializar a geração da projeção** — dois commits concorrentes no mesmo `STATUS.md` é o único conflito que sobra.

### Identity — resolvido pela Fatia 4.5 (ADR-015)

- ~~Fluxo de reconsentimento de escopo OAuth~~ — **não é mais necessário**. A **SPEC-008 (Fatia 4.5)** migra para **GitHub App** antes desta fatia: as permissões (`Issues: read & write`) já vêm da instalação, e as escritas usam o **installation token**, com identidade `proplan[bot]`. Esta fatia apenas **consome** `GithubAuth.installationToken(projectId)`.
- **Projeto sem instalação do App** (`installationStatus = missing`): board em somente leitura, faixa com CTA para reinstalar — comportamento já definido na SPEC-008.
- **Repo com Issues desabilitada** (`repository.has_issues === false`): **modo degradado** — o board carrega em **somente leitura** a partir do `docs/STATUS.md` existente, com faixa explícita "Issues desabilitada neste repo — board somente leitura". **Não** implementamos o write-path em markdown (era o ADR-005; morreu). Habilitar Issues resolve, e a UI diz isso.

### Migração do bootstrap da Fatia 3

A SPEC-003 entregou "gerar proposta de `STATUS.md` por IA → aprovar → commitar". Com o ADR-011 isso passa a produzir estado no lugar errado. Nesta fatia o fluxo vira:

- CTA "Gerar proposta de backlog com IA" → IA propõe uma lista de cards → **editor de revisão na UI** → "Aprovar e criar" → **cria N issues** (com labels de coluna e prioridade) → gera e commita a projeção.
- Projeto que **já tem** `docs/STATUS.md` legado (escrito à mão ou commitado pela Fatia 3): CTA **"Importar cards como Issues"** — parse do arquivo, prévia editável, cria as issues. **Importação é sempre manual** (decisão do PI): criar issues em massa sem o usuário pedir é o tipo de ação que assusta e é difícil de desfazer.
- **Detecção e aviso** (decisão do PI): o `sync-job` marca `Project.needsIssueImport = true` quando o repo tem `docs/STATUS.md` **sem** cabeçalho de projeção **e** nenhuma issue com label `proplan:*`. A UI então mostra: banner persistente na aba Kanban (`Este projeto tem um STATUS.md legado — importar como Issues?`) + **badge no card do projeto no catálogo**, para o aviso aparecer sem precisar abrir o projeto. O board fica em modo leitura sobre o markdown até a importação.
- Após a importação, o `docs/STATUS.md` legado é **deixado no lugar** com um aviso commitado apontando para a nova projeção (`> migrado para Issues — ver .proplan/STATUS.md`). Não apagamos doc de ninguém.
- O endpoint `POST /projects/:id/bootstrap/status/commit` da SPEC-003 é **substituído** pelos novos abaixo.

### Web — aba Kanban (ativa)

- dnd-kit conforme `DESIGN.md`: drag com tilt/sombra, placeholder tracejado, soltar com spring; UI otimista + borda pulsante no card até a API confirmar; toast de resultado (nunca no gesto).
- Card exibe número da issue (`#42`), título, label de prioridade, **avatar do assignee** (ou espaço vazio) e link "abrir no GitHub". **Autor não é exibido** — sempre `proplan[bot]` ou o PI; informação zero.
- **Atribuir/desatribuir** pelo popover de edição: lista de colaboradores do repo (`GET /repos/{o}/{r}/assignees`), seleção única, opção "ninguém".
- Criar card inline no topo da coluna; editar em popover; **descartar** = mover para a coluna Descartado (confirmação).
- **Coluna Descartado**: visível, colapsada por padrão (não polui o board), com contador. Visual distinto de Feito (cinza/riscado vs. verde) — Feito é conquista, Descartado é decisão.
- Ordenação dentro da coluna: **determinística** (prioridade, depois `updated_at` desc). Reordenar manualmente **não entra** (Issues não tem ordem; exigiria Projects v2).

## Fora de escopo

Webhooks/túnel (ADR-009); **GitHub Projects v2**; ordenação manual dentro da coluna; **sub-issues** (rejeitadas no ADR-011: o board é uma grade plana; o único ganho — barra `3/7` — o `DEVELOPMENT.md` já dá. Reavaliar no MVP2 **só se** o board plano se provar grosso) e issue types; milestones; **assignees múltiplos** (um só — ver emenda); **exibição do autor** (ruído: sempre `proplan[bot]` ou o PI); filtros/busca no board; WIP limits; colunas customizadas; deleção real de issue; write-path em markdown para repos sem Issues (modo degradado é read-only, por decisão).

## Critérios de aceite

- [ ] Mover card na UI aplica/troca a label `proplan:*` na issue correspondente no GitHub; recarregar o ProPlan reflete o estado vindo da API.
- [ ] Mover para **Feito** aplica `proplan:done` e a issue **continua `open`** no GitHub. Mover para **Finalizado** é o que a **fecha**.
- [ ] **Issue `closed` sem label `proplan:*`** (fechada direto no GitHub, ou por um `closes #N` de um PR qualquer): cai em **Finalizado**, com badge **"fechada fora do ProPlan"**. Em repo comum, `closed` significa concluído — forçar um estado exótico seria impor nossa convenção (ADR-014). Mas a **ausência de evidência de aceite é sinalizada**, nunca disfarçada.
- [ ] Criar card cria issue com título e labels corretas; editar altera título/prioridade.
- [ ] **Assignee**: atribuir pelo popover aplica `assignees` na issue do GitHub; o avatar aparece no card; desatribuir remove e o card fica com **espaço vazio** (não placeholder).
- [ ] Issue que veio do GitHub com **2+ assignees** mostra o primeiro + `+N`; editar pelo ProPlan **substitui** por um só.
- [ ] **Badge "sem dono"**: card em **Em Andamento** sem assignee mostra badge âmbar; atribuir alguém faz o badge sumir.
- [ ] **Autor não aparece em card nenhum** (é sempre `proplan[bot]`/PI — decisão explícita, não esquecimento).
- [ ] **Descartar** move para a coluna Descartado (issue `closed` + `proplan:descartado`); a coluna é visível e colapsável; **nenhuma issue é deletada** em nenhum fluxo.
- [ ] **Feito × Finalizado**: mover para Finalizado aplica `proplan:finalizado` numa issue já `closed`; a issue **não muda de estado no GitHub** (continua `closed`).
- [ ] **Nenhuma automação produz "Finalizado".** Só a ação explícita do dono no board (ou aplicar a label à mão no GitHub) leva um card para Finalizado.
- [ ] **Comentário de carimbo**: mover para Finalizado/Descartado posta um comentário na issue (`proplan: finalizado pelo PI em <data>`), visível no GitHub. Mover de volta **não apaga** o comentário.
- [ ] Feito (aberta) e as duas colunas fechadas (Finalizado, Descartado) são mutuamente exclusivas: uma issue `closed` com `proplan:finalizado` **não** aparece em Feito nem em Descartado; uma issue `open` com `proplan:done` aparece só em Feito.
- [ ] Arrastar um card de Descartado para A Fazer **reabre** a issue e remove a label `proplan:descartado`.
- [ ] Feito (aberta, `proplan:done`) e Descartado (fechada, `proplan:descartado`) são distinguíveis: nenhuma issue aparece nas duas.
- [ ] Um PR aberto no repo **não aparece** como card no board (filtro de `pull_request`).
- [ ] Issue aberta sem label `proplan:*` aparece no Backlog.
- [ ] Após uma mutação, `.proplan/STATUS.md` é regravado com o cabeçalho de artefato gerado, os números das issues e a mensagem de commit padrão.
- [ ] Arrastar 5 cards em sequência rápida gera **um** commit de projeção (debounce), não cinco.
- [ ] **Defasagem (ADR-010) não é mascarada**: uma sequência de mutações no board (que gera commits em `.proplan/`) **não altera** `lastDocsCommitAt` nem apaga o ⚠️ de docs defasados. Teste explícito — é a razão de a projeção morar fora de `docs/`.
- [ ] Editar `.proplan/STATUS.md` à mão no GitHub e sincronizar: o ProPlan **avisa** que o arquivo diverge e o sobrescreve na próxima projeção — sem perda de estado (o estado está nas Issues).
- [ ] Token sem escopo de escrita → UI pede reconsentimento com CTA clara; **não** aparece 403 cru.
- [ ] Repo com Issues desabilitada → board somente leitura a partir do `docs/STATUS.md`, com faixa explicativa; nenhuma mutação é oferecida.
- [ ] **Aviso de importação**: projeto com `docs/STATUS.md` legado e nenhuma issue `proplan:*` mostra badge no catálogo **e** banner na aba Kanban; o board fica em leitura até importar. Nada é criado automaticamente.
- [ ] "Importar como Issues": prévia editável → cria as issues nas colunas certas → commita a projeção → o `docs/STATUS.md` legado permanece no repo com o aviso de migração.
- [ ] Bootstrap por IA propõe cards, o usuário revisa, aprova, e as issues são criadas (não mais um `STATUS.md` escrito por IA).
- [ ] UI otimista: card muda de coluna imediatamente, pulsa até confirmar; erro reverte o card e explica.
- [ ] **A borda pulsante para em `applied`** (issue confirmada), **não** espera o commit da projeção. Teste: arrastar 1 card e verificar que ele para de pulsar **antes** de a janela de debounce fechar.
- [ ] **Falha ao commitar a projeção não reverte card nenhum**: as issues continuam certas, a UI mostra aviso não-bloqueante, e o próximo sync reconcilia o arquivo.

## Contratos

- **API**: `GET /projects/:id/board` (colunas+cards, do último sync) · `POST /projects/:id/board/mutations` → `202 {mutationId}` · `GET /projects/:id/board/mutations/:mutationId` → **`queued|applying|applied|failed`** · `POST /projects/:id/board/import-from-status` (migração do legado) · `POST /projects/:id/board/bootstrap` (propõe cards por IA) · `POST /projects/:id/board/bootstrap/apply` (cria as issues aprovadas).

**Confirmação é por polling do `mutationId`** — sem webhook (ADR-009), sem SSE (YAGNI para usuário único local). Mesmo padrão do `sync-run` da Fatia 2; nenhuma infra nova.

**A mutação termina em `applied`, não na projeção.** O estado do card depende **só** da Issues API — a projeção do `.proplan/STATUS.md` é **consequência, não requisito**, e tem debounce (5 cards = 1 commit, segundos depois). Se `done` esperasse a projeção, o card ficaria **pulsando durante toda a janela de debounce**, aguardando um commit que nem é sobre ele.

Portanto:

- `applied` = issue confirmada no GitHub → **a borda pulsante do card para aqui**. É o fim do ciclo de vida da mutação.
- A projeção roda em background, com **indicador global discreto** no header do board (`salvando no repo…` → some), **nunca por card**.
- **Projeção que falha não reverte card nenhum** — o estado está nas Issues, e ele está certo. A UI mostra um aviso não-bloqueante (`não foi possível atualizar .proplan/STATUS.md — tentar de novo`) e o próximo sync reconcilia. Falha de artefato de build não pode contaminar a fonte de verdade.
- **Prisma**: `Issue { id, projectId, number, title, state, column, priority?, assigneeLogin?, assigneeAvatarUrl?, assigneeCount Int @default(0), htmlUrl, closedAt?, updatedAt }` (`assigneeCount` só para o `+N` quando a issue veio do GitHub com mais de um) — **cache derivado da API, não fonte**. `BoardMutation { id, projectId, type, payload Json, status, error?, createdAt, finishedAt? }` para auditoria e estado da fila. `Project` ganha `needsIssueImport Boolean @default(false)` (aviso de STATUS.md legado).
- `board` consome: `GithubIssuesClient` (novo, em `board/infrastructure`), o write-back compartilhado da Fatia 3 (agora com segundo consumidor — promover a shared, conforme a nota da SPEC-003), `IngestionService.enqueueSync`, e do `identity` (ADR-015): **`GithubAuth.userToken`** para ler issues e **`GithubAuth.installationToken`** para toda escrita (issue, label, commit da projeção). Nunca o contrário.
- **Removido**: o parser/serializador *round-trip fiel* de `STATUS.md` da spec anterior. Sobram um **gerador** (issues → markdown) e um **parser de leitura** (usado só na importação do legado e no modo degradado).

## Notas técnicas

- **Labels precisam existir**: criar as labels `proplan:*` e `prio:*` no repo-alvo na primeira mutação (idempotente — `POST /labels` retorna 422 se já existe; tratar como sucesso).
- **Rate limit**: o board lê issues a cada sync. Usar ETag/`If-None-Match` e paginação com `per_page=100`. Repo com centenas de issues fechadas: filtrar `state=open` + `state=closed&since=` para não puxar histórico inteiro toda vez.
- **A projeção pode conflitar consigo mesma** (dois jobs gerando `STATUS.md`): resolvido pela fila serializada por projeto + SHA base + 1 retry. É o único conflito que sobrou.
- **Custo de reversão**: as labels `proplan:*` são a única marca deixada no repo-alvo. Se o modelo mudar (Projects v2 no MVP2), migrar é reler as labels e escrever o campo Status — sem perda de dado.

### Separação `docs/` × `.proplan/` (decisão do PI, 2026-07-12)

> **`docs/` = conteúdo humano. `.proplan/` = artefato gerado pelo ProPlan.**

**Problema**: o ADR-010 calcula defasagem com `lastDocsCommitAt` = último commit em `path=docs`. Se a projeção morasse em `docs/`, cada card arrastado geraria um commit em `docs/` — `lastDocsCommitAt` viraria "agora", o ⚠️ de documentação defasada sumiria, e o produto passaria a **mentir por construção**. Falso negativo fatal: quanto mais o usuário usa o board, mais cega fica a detecção de doc podre.

**Descartado**: subdiretório `docs/.proplan/`. **Não resolve** — a Commits API com `path=docs` **inclui subdiretórios**. Registro do erro para ninguém tentar de novo.

**Descartado**: filtrar commits pela mensagem (`proplan:`) no cálculo. Funciona, mas pagina (board ativo = dezenas de commits seguidos), depende de heurística de string, e envelhece mal — no MVP2 mais artefatos gerados entram em jogo, e cada um vira uma exceção nova. Pior: filtraria por engano os commits de `docs/CONTEXT.md` (ADR-013), que são **conteúdo humano** e *devem* contar como frescor.

**Decidido**: a projeção vive em **`.proplan/STATUS.md`**, na raiz do repo-alvo, fora de `docs/`. `path=docs` continua puro, o cálculo continua verdadeiro, e a regra escala: todo artefato gerado pelo ProPlan (projeção agora; handoff e drift no MVP2) mora em `.proplan/`. Conteúdo humano capturado pela UI do ProPlan — como `docs/CONTEXT.md` (asserção humana) — **continua em `docs/`**, porque é escrita humana de verdade e deve contar como frescor.

**Consequência para o dogfooding**: este repo (`rrb-proplan`) tem `docs/STATUS.md` escrito à mão como roadmap real. No dia em que o ProPlan gerenciar a si mesmo (previsto na Fatia 4), esse arquivo cai no fluxo de importação: o roadmap migra para Issues e o arquivo vira projeção. Não bloqueia esta fatia; está registrado.

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-12:

1. **Descartado é coluna visível** ✔ — rastreabilidade e histórico. Coluna colapsada por padrão, visual distinto de Feito. Issue nunca é deletada.
2. **Projeção fora de `docs/`** ✔ — `.proplan/STATUS.md`. Regra geral: `docs/` = humano, `.proplan/` = gerado. Ver nota técnica acima.
3. **Importação manual** ✔ — com detecção automática e aviso ativo (`Project.needsIssueImport`): badge no catálogo + banner na aba Kanban. Nunca cria issues sem o usuário mandar.
