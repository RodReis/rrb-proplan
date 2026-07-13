---
proplan: v1
spec: MVP2
fatia: 9+
status: rascunho # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-12
---
# MVP2 — Memória operacional verificável

Documento de escopo do MVP2. **Não é uma fatia** — é o guarda-chuva que define a tese, o modelo de dados e a ordem das fatias 9+. Cada bloco abaixo vira uma SPEC própria antes de ser codificado.

> **Pré-condição**: MVP1 (Fatias 1–7) entregue e aceito. Nada aqui começa antes.

---

## 1. Tese

> **Memória operacional verificável: toda resposta aponta evidência — commit, arquivo, issue, PR, workflow ou decisão, com data e SHA.**

Essa frase é o norte do produto e o critério de corte de qualquer feature. Se uma feature não aumenta a capacidade de responder **com prova**, ela não entra no MVP2.

O teste que ela precisa passar: *por que não usar só o GitHub MCP?* Porque o GitHub MCP entrega **fatos brutos** ("a issue #12 existe", "o check falhou"). Ele não entrega **julgamento com procedência** ("a próxima ação confiável é X, porque o ADR-004 de 12/03 diz Y e o CI de ontem confirma Z, e a confiança disso é 0.82 pelo seguinte cálculo"). O ProPlan é a **camada de memória por cima** do GitHub — complemento, nunca concorrente.

**Corolário não-negociável**: quando a confiança fica abaixo do limiar, a resposta correta é **"não sei — doc ausente/defasada"**, com link do que falta. Um sistema que sabe recusar vale mais que um que sempre responde. O modo de falha que mata o produto não é o silêncio — é a resposta confiante e errada.

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

| pergunta do agente | tool |
|---|---|
| onde eu parei? | `get_project_state` |
| qual issue devo pegar? | `get_next_task` |
| quais arquivos de contexto preciso ler? | `get_handoff_context` |
| qual é a Definition of Done? | `get_handoff_context` |
| quais testes rodam antes do PR? | `get_handoff_context` |
| **o que eu não devo mexer?** | **`get_constraints`** ← a de maior valor; só existe graças ao ADR-013 |

Mais: `explain_project`, `find_blockers`.

**Fora do MVP2**: `sync_github_project`, `update_status_from_pr` — escrita autônoma de estado por agente só depois do ADR-011 estabilizado e com trilha de auditoria. Agente que escreve estado sem supervisão é como o produto se corrompe.

### Resources

`proplan://repo/{owner}/{repo}/{overview|state|architecture|kanban|risks|tests|deploy|constraints}`

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

Consumível por MCP (agente) e exportável em markdown (humano).

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

1. **Fatia 9** — Modelo canônico + proveniência + confiança determinística (ADR-012). *É a fundação: sem isso o MCP não tem o que servir.*
2. **Fatia 10** — `docs/CONTEXT.md` + captura de asserção humana (ADR-013). *O fosso.*
3. **Fatia 11** — MCP Server com contrato de evidência e as 6 tools.
4. **Fatia 12** — ~~Migração Issues↔`STATUS.md` (ADR-011)~~ → **antecipada para a Fatia 5** (decisão do PI, 2026-07-12). Sobra no MVP2: **GitHub Projects v2** (campo Status nativo, ordenação manual), **sub-issues** e **issue types**.
5. **Fatia 13** — Drift + handoff exportável.
6. **Fatia 14** — Views; portfólio primeiro.

---

## Perguntas abertas

> Tudo aqui **BLOQUEIA** implementação.

1. ~~ADR-011: antecipar para a Fatia 5?~~ **RESOLVIDA (PI, 2026-07-12): sim, antecipada.** A SPEC-005 foi reescrita sobre Issues. As perguntas abertas remanescentes migraram para a própria SPEC-005.
2. **Limiar de recusa do MCP**: abaixo de qual `confidence` a tool recusa em vez de responder? Sugestão: configurável, padrão `0.5`.
3. **Convenção v2**: `docs/CONTEXT.md` e a proveniência por campo exigem `proplan: v2`. Confirmar que o parser mantém compat com v1 por um ciclo (regra atual da `CONVENTION.md`).
4. **Cadência de pergunta ao humano** (ADR-013): quando o ProPlan pergunta "isso aqui é intencional?" — no sync? Ao detectar drift? Sob demanda? Perguntar demais mata o canal.
5. **Portfólio**: quantos repos você realmente pretende gerenciar? Se forem ≤ 5, a view de portfólio desce de prioridade e a Fatia 14 pode nem existir.
