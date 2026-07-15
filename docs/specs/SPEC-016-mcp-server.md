---
proplan: v1
spec: SPEC-016
fatia: 11
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-14 (4 decisões do PI incorporadas)
updated: 2026-07-14
---
# SPEC-016 — Fatia 11: MCP Server do ProPlan (contrato de evidência + as 6 tools)

> **O diferencial.** O consumidor primário do ProPlan **não é o humano — é o agente.** Esta fatia transforma o objeto canônico (Fatia 9) e a asserção humana (Fatia 10) em algo que o agente consulta, com **procedência obrigatória** em toda resposta. É o que fecha o núcleo do MVP2 (9→10→11).

## Objetivo

Expor o julgamento do ProPlan a um agente, via MCP, sob um **contrato de evidência sem exceção**: toda resposta carrega evidência datada e confiança; **sem evidência, a tool recusa** em vez de responder. É a materialização do corolário do MVP2 — *"um sistema que sabe recusar vale mais que um que sempre responde; o modo de falha que mata o produto é a resposta confiante e errada"*.

## O que este servidor NÃO faz (ADR-017 — é metade da spec)

> **O ProPlan nunca é a segunda fonte de um fato que o GitHub serve ao vivo.**

- **Nada de pass-through**: não lista issues, não devolve corpo de issue, estado de PR, resultado de check. O GitHub MCP oficial já serve isso e **sempre estará mais fresco** (sem webhook — ADR-009 — nosso cache é foto). Servir isso deixaria o agente receber **respostas diferentes do ProPlan e do GitHub na mesma sessão, sem saber qual vale**. Ele não vê botão de Sincronizar; **ele age**.
- **Corolário de desenho, obrigatório**: toda tool **referencia** a issue (número + URL) — **nunca a reproduz**. Entregamos decisão + evidência; o detalhe o agente busca na fonte.
- **Consequência aceita**: o agente precisa de **dois** MCPs (o do GitHub e o nosso); o nosso depende do outro para ser útil. Complementar, nunca concorrente.

## O contrato de evidência (obrigatório, sem exceção)

Toda resposta de toda tool:
```json
{
  "answer": "...",
  "confidence": 0.82,
  "evidence": [
    { "type": "fato",     "url": "...", "path": "docs/DECISIONS.md", "sha": "a1b2c3", "date": "2026-05-04" },
    { "type": "asserção", "author": "rodrigo", "date": "2026-06-10", "sha": "d4e5f6", "status": "a-revalidar" }
  ],
  "refusal": null
}
```
**`evidence: []` vazio ⇒ a tool DEVE retornar `refusal` (com o que falta), nunca `answer`.** Não existe resposta sem prova. A marca `a-revalidar` de uma asserção (Fatia 10) é **sempre** propagada, **nunca** omitida (ADR-013).

## As 6 tools = as 6 perguntas do agente (MVP2 §4)

| pergunta | tool | por que não é o GitHub MCP |
|---|---|---|
| onde eu parei? | `get_project_state` | julgamento sobre o estado (confiança, drift) — não uma listagem. Consome o modelo canônico (Fatia 9) |
| qual issue devo pegar? | `get_next_task` | *"pegue a #42; não a #38 (decisão de arquitetura nunca tomada); não a #51 (você marcou 'não mexer')"* — combina Issues (Fatia 5) + constraints (Fatia 10) + confiança (Fatia 9) |
| que arquivos ler? · qual a DoD? · que testes rodam? | `get_handoff_context` | derivado do `DocumentResolver` (Fatia 6) + doc + asserção |
| **o que não mexer?** | **`get_constraints`** | **o fosso** — asserção humana (Fatia 10). O Copilot Memory exige citar código; essas asserções não têm código a citar |
| — | `explain_project` | resumo com procedência, para o agente se situar |
| — | `find_blockers` | julgamento derivado: o que trava cada frente |

Cada tool referencia as issues por número+URL; nenhuma as reproduz.

## Escopo

1. **Servidor MCP** que expõe as 6 tools sob o contrato de evidência. **Adaptador fino** sobre a API existente (modelo canônico da 9, asserções da 10, board da 5, resolver da 6) — **não reimplementa** nada (fonte única; ADR-001: consome por interface pública, não importa entidade interna).
2. **Enforcement do contrato** no nível do servidor: qualquer tool que montaria `answer` com `evidence` vazio retorna `refusal` — invariante testável, não responsabilidade de cada tool.
3. **Propagação de `a-revalidar`** obrigatória em toda evidência de asserção.
4. **Recusa por confiança** abaixo do limiar (reusa o limiar da Fatia 9 — ver Perguntas abertas).
5. **Resources** `proplan://repo/{owner}/{repo}/{overview|state|architecture|risks|tests|deploy|constraints}` — projeções read-only sobre o mesmo material (sem `kanban` — ADR-017). **Obrigatórios nesta fatia** (Decisão 4 do PI).
6. **Sem auth no MVP** (Decisão 1 do PI, revista) — o MCP local serve os projetos do **único usuário local**, sem porteira de token. Coerente com "100% local até o fim do MVP". A auth (token/escopo por usuário) pertence à **Fatia 8** (multi-tenant) e só se materializa se o PI produtizar. As leituras do GitHub seguem com o **user-to-server token** do ADR-015 (respeita a visibilidade do dono) — isso é ortogonal e continua valendo.

## Fora de escopo (explícito)

- **Escrita autônoma de estado por agente** (`sync_github_project`, `update_status_from_pr`) — MVP2 é explícito: só depois do ADR-011 estabilizado e com trilha de auditoria. **Agente que escreve estado sem supervisão é como o produto se corrompe.**
- **Qualquer pass-through do GitHub** (ADR-017).
- **Qualquer auth do agente ao MCP** → Fatia 8 (multi-tenant). No MVP, o MCP local roda sem porteira (Decisão 1 revista). Só há trabalho de auth quando existir um segundo usuário.
- **Sinais `contradição`/`drift`** na confiança — seguem como slot da Fatia 9; o MCP serve o que a 9 calcula.

## Contratos

**Sem novo modelo Prisma** — o MCP é adaptador de leitura sobre o que 9/10/5/6 já persistem. Toda a lógica de julgamento **já mora** nos domínios dessas fatias; o MCP as compõe.

**Domínio puro e testável** (`mcp/domain/`): `enforceEvidenceContract(result): Answer | Refusal` (invariante central), `nextTask(issues, constraints, confidence): Decision` (o julgamento de `get_next_task`, puro), `blockers(...)`.

**Empacotamento**: servidor MCP local (stdio) — coerente com "ambiente 100% local até o fim do MVP". Roda como processo que fala com a API/serviços do ProPlan; **não** duplica acesso a banco fora dos módulos.

## Critérios de aceite

- [ ] **Contrato de evidência é invariante**: teste que força cada tool a um cenário sem evidência e prova que retorna `refusal`, nunca `answer`. Não há caminho que responda sem prova.
- [ ] `get_constraints` devolve as asserções da Fatia 10 **com a marca `a-revalidar` sempre presente** quando aplicável; um teste prova que a marca nunca é omitida.
- [ ] `get_next_task` **não reproduz** o corpo da issue — referencia número+URL; a decisão cita a evidência (constraint que excluiu #51, decisão ausente que excluiu #38).
- [ ] Nenhuma tool faz pass-through de fato do GitHub (listar issues, corpo, estado de PR) — revisão contra o ADR-017 é critério de aceite.
- [ ] Confiança em toda resposta vem do cálculo determinístico da Fatia 9 (clicável/auditável); o MCP não recalcula nem pede ao LLM.
- [ ] Abaixo do limiar → `refusal` com o que falta, nunca palpite.
- [ ] O servidor conecta como MCP local e responde às 6 tools + resources; um agente (Claude Code) consegue consumir.

## Notas técnicas

- **Adaptador, não reimplementação** — o valor (julgamento) já está nos domínios de 9/10; o MCP é a superfície. Se aparecer lógica de julgamento **nova** no MCP, ela provavelmente pertence a um domínio de fatia anterior (cheiro de arquitetura).
- **ADR-001**: o módulo `mcp` consome `canonical`, `context`, `board`, `catalog` por interface pública; não importa entidade interna de nenhum.
- **Octokit é ESM-only** (CLAUDE.md) — se o MCP precisar de chamadas GitHub próprias, usar o client `fetch` já existente, não reintroduzir Octokit.

## Decisões do PI (2026-07-14) — nenhuma pergunta aberta

1. **Auth: sem auth no MVP** (decisão revista em 2026-07-14 — o PI voltou à recomendação). O MCP local serve o único usuário local sem porteira, coerente com "100% local até o fim do MVP". Qualquer auth do agente ao MCP pertence à **Fatia 8** (multi-tenant) e **só existe se o PI produtizar** — enquanto for usuário único local, não é necessária. *(Histórico: o PI chegou a escolher token local leve; reconsiderou e reverteu para sem-auth.)*
2. **As 6 tools já**, sob o mesmo contrato de evidência. `get_project_state`/`get_handoff_context`/`get_constraints`/`explain_project` mais diretas; `get_next_task`/`find_blockers` como o julgamento mais rico.
3. **Limiar unificado com a Fatia 9** (`Settings`, padrão 0.4). Um só botão; **não** há limiar separado do MCP (supersede a sugestão de 0.5 do MVP2 §Perguntas).
4. **Tools + resources juntos**, obrigatórios na mesma fatia.
