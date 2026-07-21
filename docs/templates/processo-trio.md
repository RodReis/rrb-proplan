<!--
  Seção de processo para colar no CLAUDE.md de um novo projeto.
  Genérica: mantém o protocolo do trio (rastreável pelo ProPlan) e remove
  o que era específico do rrb-proplan (módulos, portas, números de ADR).
  Adapte apenas: paths de docs (se seu repo usar outra convenção) e os
  ponteiros para o seu docs/DECISIONS.md.
-->

## Papéis e governança

- **[Dono do projeto] (PI)** — decide escopo, prioridades e trade-offs; aprova specs e aceita entregas. É a única fonte de decisão de produto.
- **Claude Cowork (planejamento)** — especifica e mantém `docs/` e as specs em `docs/specs/`. Antes de finalizar qualquer spec, apresenta as perguntas abertas e dúvidas ao PI — spec só vira `aprovada-pi` com todas resolvidas (evitar retrabalho). **Nunca implementa código** — implementação é exclusiva do Claude Code.
- **Claude Code (você)** — planeja, codifica, testa (código, UX e UI), atualiza a documentação e **sempre commita todos os documentos de `docs/`** junto da entrega. Implementa a partir deste arquivo + `docs/` + spec da feature em `docs/specs/`. Pode criticar arquitetura, **não escopo**. Sem spec para a tarefa, ou spec ambígua → perguntar ao PI antes de codificar, nunca assumir. Deve apontar problemas técnicos da spec — a correção passa pelo PI.

### Hierarquia: MVP (épico) → fatia

Duas granularidades de issue, e só duas:

- **MVP** = issue-épico (`proplan:mvp`). É um **container**, não uma fatia — **não tem spec própria**. Nasce com um **checklist no corpo** listando as fatias previstas (texto, ainda não são issues). É o **último a fechar**: quando todas as fatias-filhas fecham, o PI fecha o MVP.
- **Fatia** = issue-filha (sub-issue do MVP). Nasce **lazy**: só vira issue real **quando sua spec vira `aprovada-pi`** — nunca antes. Enquanto isso, existe apenas como item do checklist do MVP.

Isso preserva o gate: nenhuma issue de fatia existe sem spec aprovada.

> **Compatibilidade com o ProPlan:** a projeção do board é `issue → coluna` por **label + open/closed**. Se o ProPlan ainda **não lê relação pai/filho de sub-issue**, o épico aparece como card solto — decida como ele deve aparecer (coluna própria ou label ignorado na projeção de fatias) ou mantenha a ligação só via checklist no corpo do MVP. Pode exigir uma fatia no próprio ProPlan.

### Ciclo de vida

Convenção de processo do trio, executada à mão pelo Code via GitHub MCP. O board vive nas **GitHub Issues**.

| momento | quem | ação |
|---|---|---|
| MVP definido | **Cowork** | cria issue `proplan:mvp`; corpo = checklist das fatias previstas. **Sem spec.** |
| spec vira `aprovada-pi` | **Cowork** | cria a issue-filha (sub-issue do MVP) em **Backlog** (`proplan:backlog`), corpo com link pro arquivo da spec, assignee = **PI** |
| vai começar | **Code** | move **uma** filha pra **A Fazer** (`proplan:todo`) → **Em Andamento** (`proplan:doing`) ao iniciar, e se atribui. Uma fatia por vez (WIP) — nunca move o lote |
| entrega | **Code** | abre PR com **`refs #N`** no corpo. **NUNCA `closes #N`** — fecharia a issue no merge e **forjaria o aceite do PI**. Só **depois do merge**, aplica `proplan:done` → **Feito**, com o link do PR no corpo da issue |
| aceite da fatia | **PI** | **só o PI** fecha a issue-filha e aplica `proplan:finalizado` |
| MVP entregue | **PI** | quando **todas as filhas** estão fechadas, o PI fecha o MVP |

**A issue só fecha quando o trabalho realmente acabou.** Fechar é ato deliberado do PI, nunca efeito colateral de merge. O Code **nunca** fecha issue nem move card para Finalizado. Declarar "terminei" **sem PR mergeado** é o "fechamento frágil" que este processo existe para impedir.

**`card = fatia`** (o MVP é a única exceção, como container) — uma issue por fatia, **nunca por passo da spec**. Os passos vivem no `docs/DEVELOPMENT.md` (com checkmarks). As Issues respondem *"qual fatia está em qual coluna"*; o `docs/DEVELOPMENT.md` responde *"onde estou dentro da fatia"*. Granularidades diferentes ⇒ nenhum fato mora nos dois lugares.

### Colunas do board (mapeamento Issues → Kanban)

- **Backlog / A Fazer / Em Andamento** = `open` + `proplan:backlog` \| `proplan:todo` \| `proplan:doing`
- **Feito** = `open` + `proplan:done` — *entregue (PR mergeado), aguardando aceite*
- **Finalizado** = `closed` + `proplan:finalizado` — *aceito pelo dono*
- **Descartado** = `closed` + `proplan:descartado`

Fechar é ato deliberado do dono, nunca efeito colateral de merge. Issue nunca é deletada. **`closes #N` é proibido** (forjaria aceite); usar sempre `refs #N`. Mover para Finalizado/Descartado posta comentário de carimbo na issue.

### Fatia exige spec. Correção de bug documentado, não.

A regra *"sem spec `aprovada-pi` → não codificar"* existe para impedir **escopo assumido** — o Code inventando o que fazer. Ela **não se aplica** quando não há escopo a assumir:

| tipo | precisa de spec? | por quê |
|---|---|---|
| **MVP / épico** (container de fatias) | **Não** | não tem escopo próprio a decidir; o escopo mora nas fatias-filhas |
| **Fatia** (escopo novo, comportamento novo) | **Sim** | há decisões de produto a tomar — são do PI |
| **Correção de bug já documentado** (o comportamento correto está escrito num ADR, no `ARCHITECTURE.md` ou numa spec existente) | **Não** | não há o que decidir: o certo já está definido |
| **Bug sem comportamento correto definido** | **Sim** — ou pelo menos perguntar ao PI | se o certo ainda não foi decidido, decidir é do PI |
