---
proplan: v1
spec: MVP2
fatia: 9+
status: rascunho # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-15
---
# MVP2 — Memória operacional verificável

Documento de escopo do MVP2. **Não é uma fatia** — é o guarda-chuva que define a tese, o modelo de dados e a ordem das fatias 9+. Cada bloco abaixo vira uma SPEC própria antes de ser codificado.

> **Pré-condição**: MVP1 (Fatias 1–7) entregue e aceito. Nada aqui começa antes.

---

## 1. Tese

> ⚠️ **Reposicionada em 2026-07-13** após o levantamento de mercado (`docs/LANDSCAPE.md`). A tese anterior era *"memória operacional verificável: toda resposta aponta evidência"*. Ela **deixou de ser diferencial** — o **GitHub Copilot Memory** (preview jan/2026, on-by-default desde mar/2026) já faz memória com **citação obrigatória e verificação just-in-time**, testada adversarialmente. Manter aquela frase como pitch principal é entrar numa comparação com a GitHub que se perde por distribuição, não por mérito.

**A tese que sobrou é mais estreita — e é defensável:**

> **A documentação que o humano escreveu é um artefato de primeira classe. O ProPlan é o único que sabe quando ela está mentindo — e o único que guarda o que só existe na cabeça do dono.**

Duas metades, e cada uma tem um motivo concreto para ninguém mais ocupar (evidência datada em `LANDSCAPE.md`):

1. **Drift da doc humana, determinístico, sem clonar código.** Swimm exige que a doc more dentro do Swimm. Mintlify e Promptless miram doc de cliente. Backstage/Cortex/Port checam se a doc **existe**, nunca se está **certa**. E o Copilot Memory verifica fatos sobre o **código** — não se o seu `ARCHITECTURE.md` está mentindo. A doc de arquitetura abandonada é órfã no mercado inteiro.

2. **Asserção humana sem citação de código** (ADR-013). A memória do Copilot **exige** citar código. *"Parei porque o Supabase não dava conta do realtime"* **não tem código para citar** — logo ele não consegue guardá-la **por construção**, não por imaturidade. É o ponto cego estrutural deles, e é o nosso fosso.

**Critério de corte**: se uma feature não fortalece uma dessas duas metades, ela não entra no MVP2.

**Corolário não-negociável**: quando a confiança fica abaixo do limiar, a resposta correta é **"não sei — doc ausente/defasada"**, com link do que falta. Um sistema que sabe recusar vale mais que um que sempre responde. O modo de falha que mata o produto não é o silêncio — é a resposta confiante e errada.

**Complemento, nunca concorrente** (ADR-017): o GitHub MCP entrega **fatos brutos**; o ProPlan entrega **julgamento com procedência** sobre eles, mais o que só ele tem. Nunca replicamos o que o GitHub já serve ao vivo.

---

## 2. Modelo canônico de retomada

Todo repo gerenciado é projetado em um objeto consultável com estas entidades:

| # | Entidade | Fonte primária |
|---|---|---|
| 1 | Projeto | `README.md`, metadados do repo |
| 2 | Objetivo | `README.md`, `CLAUDE.md` |
| 3 | Módulos | `docs/ARCHITECTURE.md` |
| 4 | Arquitetura | `docs/ARCHITECTURE.md` |
| 5 | Decisões / ADRs | `docs/DECISIONS.md` |
| 6 | Backlog detectado | Issues (ADR-011) |
| 7 | Último estado conhecido | Issues + commits + PRs + releases |
| 8 | Próxima ação recomendada | derivada (6+7+11) |
| 9 | Riscos | derivada + asserção humana |
| 10 | Testes | `docs/TESTING.md`, `.github/workflows/` |
| 11 | Deploy | `docs/DEPLOY.md`, releases |
| 12 | Agentes / skills | `CLAUDE.md`, `.claude/` |
| 13 | **O que não mexer** | **`docs/CONTEXT.md` — asserção humana (ADR-013)** |

**Cada campo carrega sua própria proveniência e confiança** — a granularidade é o *campo*, não o documento. É isso que permite responder "sei o objetivo (fato, 3 dias) mas não sei o deploy (ausente)" em vez de devolver um resumo uniforme de credibilidade desconhecida.

### Classes de proveniência

| classe | origem | carrega |
|---|---|---|
| `fato` | extraído do repo | path + linha + sha + data |
| `inferência` | LLM | spans citados que a sustentam (ADR-012) |
| `hipótese` | derivada, não confirmada | o que confirmaria |
| `asserção` | humano (ADR-013) | autor + data + sha + paths citados + estado de validade |

Entidade sem proveniência não existe. Não há campo "genérico".

---

## 3. Confiança (ADR-012)

Determinística, quatro sinais: `staleness`, `cobertura`, `contradição`, `drift`. O LLM detecta candidatos a contradição citando **dois spans concretos**; a regra determinística julga. O número nunca sai do LLM.

`cobertura` já tem base: é o `DocumentResolver` do **ADR-014** (Fatia 6) — entidades resolvidas nos níveis 1–3 sobre o total. Nível 4 (ausente) é o que derruba o score, e o nível de resolução (convenção > alias > IA) modula a confiança de cada campo. O MVP2 **consome** esse resolver; não constrói nada novo aqui.

**Requisito de UX**: o score é sempre clicável e mostra a conta. `0.62 = 42 dias de staleness · 4/13 entidades ausentes · 1 contradição (ARCHITECTURE.md:31 vs ADR-004:12)`.

---

## 4. MCP Server do ProPlan

O diferencial. O consumidor primário do ProPlan **não é o humano — é o agente**.

### Contrato de evidência (obrigatório, sem exceção)

Toda resposta de toda tool retorna:

```json
{
  "answer": "...",
  "confidence": 0.82,
  "evidence": [
    { "type": "fato",     "url": "...", "path": "docs/DECISIONS.md", "line": 31, "sha": "a1b2c3", "date": "2026-05-04" },
    { "type": "asserção", "author": "rodrigo", "date": "2026-06-10", "sha": "d4e5f6", "status": "a-revalidar" }
  ],
  "refusal": null
}
```

`evidence: []` vazio ⇒ a tool **deve** retornar `refusal` em vez de `answer`. Não existe resposta sem prova.

### Tools = as 6 perguntas do agente

Estas seis perguntas **são** a especificação do produto:

| pergunta do agente | tool | por que não é o GitHub MCP |
|---|---|---|
| onde eu parei? | `get_project_state` | julgamento sobre o estado, com confiança e drift — não uma listagem |
| qual issue devo pegar? | `get_next_task` | *"pegue a #42; não a #38 (decisão de arquitetura nunca tomada); não a #51 (você marcou 'não mexer')"* — o GitHub não conhece as suas asserções nem a podridão da sua doc |
| quais arquivos de contexto preciso ler? | `get_handoff_context` | derivado do `DocumentResolver` (ADR-014) |
| qual é a Definition of Done? | `get_handoff_context` | vem da doc + asserção |
| quais testes rodam antes do PR? | `get_handoff_context` | doc + workflows |
| **o que eu não devo mexer?** | **`get_constraints`** | **o fosso** (ADR-013). O Copilot Memory exige citação de código; essas asserções **não têm código para citar** |

Mais: `explain_project`, `find_blockers`.

### O que **não** expomos (ADR-017)

> **O ProPlan nunca é a segunda fonte de um fato que o GitHub serve ao vivo.**

**Cortado**: qualquer pass-through — listar issues, corpo de issue, estado de PR, resultado de check. O GitHub MCP oficial já expõe tudo isso, **e sempre estará mais fresco que nós** (sem webhook — ADR-009 — nosso cache é uma foto). Se servíssemos isso, o agente poderia consultar os dois na mesma sessão e **receber respostas diferentes, sem saber qual é a certa**. Ele não vê botão de Sincronizar; **ele age**.

**Corolário de desenho**: as tools **referenciam** a issue (número + URL) — **nunca a reproduzem**. Entregamos decisão e evidência; o detalhe o agente busca na fonte.

**Consequência aceita**: o agente precisa de **dois** MCPs conectados (o do GitHub e o nosso), e o nosso depende do outro para ser útil. Complementar, nunca concorrente — é a tese desde o começo.

**Fora do MVP2**: `sync_github_project`, `update_status_from_pr` — escrita autônoma de estado por agente só depois do ADR-011 estabilizado e com trilha de auditoria. Agente que escreve estado sem supervisão é como o produto se corrompe.

### Resources

`proplan://repo/{owner}/{repo}/{overview|state|architecture|risks|tests|deploy|constraints}`

**`kanban` foi removido da lista** (ADR-017): seria pass-through do board — o agente lê issues no GitHub MCP.

---

## 5. Drift docs × realidade

O guarda-costas do handoff — é o que impede o handoff de mentir.

**Limite honesto, imposto pelo ADR-003**: o ProPlan **não lê código**. Portanto ele **não pode** afirmar "a doc promete X e o código faz Y". Ele compara doc × **sinal do GitHub**:

- doc cita workflow que não existe em `.github/workflows/`
- doc afirma "deploy em produção ativo" e não há release há 8 meses
- doc descreve módulo que nenhum path de commit tocou desde a criação
- `TESTING.md` promete suíte que nenhum workflow executa

É menos ambicioso do que "drift de código" e é **verdadeiro** — o que importa mais.

---

## 6. Handoff

O *output* do produto. Contexto mínimo para um agente retomar: estado atual + próxima ação + arquivos a ler + DoD + testes + **restrições (o que não mexer)** + confiança de cada bloco.

Consumível por MCP (agente) e exportável em markdown (humano). **Especificado na `SPEC-018` (Fatia 13.5, `aprovada-pi` 2026-07-15)** — sequenciada **antes** da Fatia 11, que herda a montagem `assembleHandoff`.

---

## 7. Views (depois — e de graça)

Radar de risco, linha do tempo, mapa de confiança, matriz de prontidão, **portfólio da fábrica** (quais projetos estão parados há N dias, com CI vermelho, com doc apodrecida).

São *consequência* dos itens 1–6, não features independentes: o dado já vai existir. Entram por último. **Exceção**: a view de **portfólio** sobe de prioridade — com múltiplos repos, ela vira o ponto de entrada diário do produto.

---

## Fora de escopo (definitivo)

- **Espelho em Linear / Jira / Notion** — regra do PI: nada que obrigue o usuário a sair do ProPlan para ver o resultado. GitHub é exceção declarada (é de onde o dado vem).
- **Reimplementar o Notion dentro do ProPlan** — buraco negro; nunca entrega. O que resolve a dor real é estreito: editor markdown com commit de volta ao repo.
- **Sonar / Sentry próprios** — exigem ler código (viola ADR-003) e é reinventar roda de 15 anos.
- **Análise de segurança/dependência própria** — só sobrevive como *leitura* de Dependabot/CodeQL/SBOM renderizada no ProPlan (dado do GitHub, não análise nossa). Já previsto no adendo ao ADR-003; exige spec própria.
- **Bootstrap de legado "do zero"** — o PI esclareceu: "legado" = projetos dele já em andamento, **que já têm alguma doc**. O trabalho é *normalizar contra a convenção*, não criar do nada. Isso reduz drasticamente o escopo desta frente.

---

## Ordem sugerida das fatias

1. **Fatia 9** — Modelo canônico + proveniência + confiança determinística (ADR-012). *A fundação: sem isso o MCP não tem o que servir.* **(entregue — SPEC-014)**
2. **Fatia 10** — `docs/CONTEXT.md` + captura de asserção humana (ADR-013). *O fosso.* (SPEC-015, `aprovada-pi`)
3. **Fatia 13.5** — Handoff exportável (SPEC-018, `aprovada-pi`). *Reposicionada em 2026-07-15: vem **antes** da 11 porque constrói o `assembleHandoff` — o domínio de montagem que o `get_handoff_context` da Fatia 11 herda (ADR-001; "adaptador, não reimplementação", SPEC-016). Depende só da 9; os blocos de 10/11 recusam honestamente até elas entregarem.*
4. **Fatia 11** — MCP Server com contrato de evidência e as 6 tools (SPEC-016, `aprovada-pi`). *Herda o `assembleHandoff` da 13.5.*
5. **Fatia 12** — ~~Migração Issues↔`STATUS.md` (ADR-011)~~ → **antecipada para a Fatia 5** (decisão do PI, 2026-07-12). Sobra no MVP2, e **só sob condição**:
   - **GitHub Projects v2** (campo Status nativo, ordenação manual) — só se a ordenação determinística do board incomodar na prática.
   - **Sub-issues** — **rejeitadas no ADR-011** (2026-07-13). O board é grade plana; sub-issue obriga a escolher entre mostrar a mãe (perde granularidade), as filhas (perde a fatia) ou as duas (duplica na tela). O único ganho real (barra `3/7`) o `DEVELOPMENT.md` já dá. **Reabrir só se** o board plano (`card = fatia`) se provar grosso demais **na prática** — não por antecipação.
   - **Issue types** — sem caso de uso hoje.
6. ~~**Fatia 13** — Drift + handoff exportável.~~ → **Drift entregue** (SPEC-013 v2.1) + **probe HTTP entregue** (SPEC-013.6); o **handoff foi desmembrado para a Fatia 13.5** (item 3, reposicionada antes da 11).
7. **Fatia 14** — Views; portfólio primeiro.

---

## Perguntas abertas

> Tudo aqui **BLOQUEIA** implementação.

1. ~~ADR-011: antecipar para a Fatia 5?~~ **RESOLVIDA (PI, 2026-07-12): sim, antecipada.** A SPEC-005 foi reescrita sobre Issues. As perguntas abertas remanescentes migraram para a própria SPEC-005.
2. **Limiar de recusa do MCP**: abaixo de qual `confidence` a tool recusa em vez de responder? Sugestão: configurável, padrão `0.5`.
3. **Convenção v2**: `docs/CONTEXT.md` e a proveniência por campo exigem `proplan: v2`. Confirmar que o parser mantém compat com v1 por um ciclo (regra atual da `CONVENTION.md`).
4. **Cadência de pergunta ao humano** (ADR-013): quando o ProPlan pergunta "isso aqui é intencional?" — no sync? Ao detectar drift? Sob demanda? Perguntar demais mata o canal.
5. **Portfólio**: quantos repos você realmente pretende gerenciar? Se forem ≤ 5, a view de portfólio desce de prioridade e a Fatia 14 pode nem existir.
