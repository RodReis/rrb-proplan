---
proplan: v1
updated: 2026-07-14
---
# Cenário Competitivo — memória do que sabíamos e quando

> **Por que este arquivo existe.** Decisões de escopo do ProPlan (o que cortar, o que é diferencial) dependem do que o mercado já faz. Isso **apodrece**. Sem registrar *o que era verdade e quando*, daqui a seis meses ninguém lembra **por que** cortamos algo — e ou refazemos o corte na base do achismo, ou desfazemos por engano.
>
> É o mesmo princípio do ADR-013 aplicado a nós mesmos: **a razão de uma decisão não está no código, está na cabeça de quem decidiu.** Aqui ela fica escrita, datada e com fonte.
>
> **Regra de uso**: nunca apagar um achado. Achado que envelheceu ganha uma linha de atualização com data. O histórico é o produto deste arquivo.

---

## Levantamento de 2026-07-13

**Contexto**: o PI pediu para verificar se alguém já faz o que o ProPlan propõe, antes de investir no MVP2.

### O achado que mudou o rumo: GitHub Copilot Memory

**Isto é o mais importante deste documento.** A GitHub construiu, publicou e **testou adversarialmente** quase exatamente a tese que o `MVP2.md` vendia como diferencial.

- **Quando**: preview em jan/2026; **on-by-default** para Copilot Pro/Pro+ desde **mar/2026**.
- **O que é**: memória = `{subject, fact, citations[], reason}` — **citação obrigatória**.
- **Verificação just-in-time**: antes de usar uma memória, o agente **revalida as citações** contra a branch atual. Código contradiz, ou a citação aponta para lugar que não existe mais → **descarta** e grava versão corrigida.
- **Testado com memórias falsas plantadas de propósito** — o mecanismo de citação segurou.
- Expira em 28 dias; verificação bem-sucedida renova. Escopo por repositório. Cross-agent dentro do Copilot (coding agent, review, CLI).
- Impacto medido por eles: +7% merge rate de PR, +3% precisão de review.

**Consequência para nós**: *"memória sem verificação é mentira"* deixou de ser insight nosso e virou **doutrina oficial publicada do maior player do mercado**. Manter "memória operacional verificável com evidência" como **pitch principal** é entrar numa comparação com a GitHub que se perde por distribuição, não por mérito.

Fontes:
- https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/
- https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/

### O limite estrutural do Copilot Memory — e o nosso fosso

A memória do Copilot **exige citação de código**. Uma asserção como:

> *"Parei porque o Supabase não dava conta do realtime e eu nunca decidi o que fazer."*

**não tem citação de código possível** — ela não existe em lugar nenhum do repositório. Logo, **o Copilot Memory não consegue guardá-la, por construção**, não por imaturidade.

É exatamente onde vive o **ADR-013** (asserção humana): "por que parei", "o que não mexer", "essa gambiarra é intencional". Não é sorte — é consequência de eles terem escolhido *o código* como única fonte de verdade verificável.

### `get_next_task` sobre issues virou commodity

O **GitHub MCP Server oficial** já expõe issues, PRs e Projects (`projects_list`, `list_project_items`, etc.). "Liste minhas issues" é chamada MCP nativa e gratuita. → Ver **ADR-017**.

Fonte: https://github.com/github/github-mcp-server

### Mapa do mercado

| Categoria | Quem | Faz | **Não** faz |
|---|---|---|---|
| **Internal Developer Portals** | Backstage (OSS, scorecards só via Soundcheck pago), **Cortex** (MCP GA), **Port** (MCP), OpsLevel, Roadie | Catálogo de serviços + **scorecards de maturidade** ("tem owner? tem oncall? tem doc?") | **Nunca verificam se a doc está *certa*** — só se ela *existe*. Vendidos para org com 200+ serviços |
| **Doc-drift** | **Swimm** (o mais forte: doc acoplada ao código por Smart Tokens), Mintlify, **Promptless** (YC W25, atualiza doc a partir de PR/commit/Slack) | Swimm sabe qual doc quebrou quando o código muda | Swimm **exige que a doc more dentro do Swimm** (formato proprietário). Mintlify/Promptless miram **docs de cliente**, não doc interna de arquitetura/decisão |
| **Docs gerados** | **DeepWiki** (Cognition/Devin) — grátis p/ repo público, **MCP remoto sem auth** | Gera wiki navegável **a partir do código** | É doc *gerada*, não **verificação da doc humana existente**. Não detecta contradição doc↔realidade |
| **Context layer p/ agente** | Unblocked ($29/user), Greptile ($30/seat), Sourcegraph (**matou o free tier**, só Enterprise), Driver.ai, Mem0/Supermemory (OSS) | Contexto de codebase via MCP | Evidência obrigatória + **recusa** quando a confiança é baixa **não é padrão** em nenhum |
| **Retomar projeto parado** | **Nenhum produto comercial.** Só skills OSS gratuitas (`agent-session-resume`, `ai-memory`, `session-handoff`, `codebase-memory` MCP) | Handoff de sessão em markdown | Ninguém trata **projeto abandonado** como caso de uso. "Codebase onboarding" existe, mas mira *contratado novo em monorepo de empresa* |

Fontes: https://www.cortex.io/post/mcp-server · https://www.port.io/blog/integrate-software-catalog-every-workflow-port-mcp-server · https://promptless.ai/ · https://cognition.com/blog/deepwiki-mcp-server · https://www.driver.ai/ · https://sourcegraph.com/mcp

---

## O que sobreviveu (e é a base do escopo atual)

1. **Drift da documentação *humana*, determinístico, sem LLM, sem clonar código.** Ninguém faz. Swimm exige doc proprietária; Mintlify/Promptless miram doc de cliente; Backstage/Cortex checam *existência*; **Copilot Memory verifica fatos sobre o código, não se o seu `ARCHITECTURE.md` está mentindo.** A doc de arquitetura que o humano escreveu e abandonou é órfã no mercado inteiro.
2. **Asserção humana sem citação de código** (ADR-013) — o ponto cego estrutural do Copilot Memory.
3. **Portabilidade**: nosso estado mora nas Issues e no `.proplan/`. Sobrevive ao ProPlan e a qualquer vendor. Copilot Memory é fechado, pago e morre se você trocar de agente.

## O que morreu

- **"Memória verificável com evidência" como pitch principal** → virou tabela em jan/2026.
- **Pass-through de fato do GitHub via nosso MCP** → commodity **e** fonte de bug (ADR-017).
- **Índice de continuidade como *ranking* de portfólio** → já estava cortado (5 projetos não precisam de ranking), e o mercado de scorecard é dominado por Cortex/Port/OpsLevel.

## Veredito registrado (2026-07-13)

- **Como produto comercial**: o mercado que o ProPlan mira (dev solo, projeto parado) historicamente **não paga**; o mercado que paga (empresa) já tem Cortex/Port/Unblocked. **Não construir com tese de venda.**
- **Como ferramenta pessoal + prova de tese**: **vale** — com o recorte de doc-drift determinístico + asserção humana. Decisão do PI mantida.

---

## Candidato de MVP2 — drift spec↔entrega (registrado em 2026-07-14)

**Origem**: o PI rodou um prompt no repo-alvo do WhatsApp pedindo um resumo das specs, e obteve dois markdowns — `TEST.md` (cobertura de testes) e `REVIEW.md` (status por spec: entregue / parcial / pendente, com o PR correspondente).

**O `REVIEW.md` não vira documento mapeado no ProPlan** — e a razão é o próprio produto:

- Ele é uma **projeção de status do trabalho**, que já tem dono: as Issues (ADR-011), projetadas em `.proplan/STATUS.md`. Mapeá-lo criaria a segunda fonte do mesmo fato que o **ADR-017** proíbe.
- Ele deriva "✅ entregue" de **PR mergeado**, sem aceite de ninguém — o *fechamento frágil* que o ProPlan existe para **detectar**, não para produzir.
- Ele erra a própria contagem: as linhas somam **45 ✅ / 3 🟡 / 2 📄**; o bloco "Resumo" afirma 42 / 4 / 0 / 4. Um retrato de status feito à mão desalinha de si mesmo em uma única passada.

**O que sobrevive dele é a *feature*, não o documento.** O `REVIEW.md` é um protótipo manual — e funcional — de uma classe de drift que o **ADR-012** já prevê como sinal (*"doc afirma artefato que o sinal do GitHub não confirma"*), mas ilustra só com infra (workflow, release, check). A classe valiosa é outra: **a spec afirma um escopo — o repo confirma que ele foi entregue?**

### As quatro regras (determinísticas, sem IA, sem clonar código)

| regra | detecta | fonte |
|---|---|---|
| **spec órfã** | spec sem issue nem PR que a referencie | Contents + Issues + PRs |
| **entrega órfã** | PR mergeado sem spec e sem `refs #N` | PRs |
| **entrega não aceita** | issue em `proplan:done` há N dias sem aceite | Issues (`closed_at` × label) |
| **spec sem teste** | spec entregue sem arquivo de teste correspondente | Git Trees |

As linhas 🟡 e 📄 do `REVIEW.md` são exatamente a saída dessas regras — `pipeline-kanban-flow-ia` (spec órfã), `mover-numero` (sem PR), `avatar-usuario` (sem teste). A feature já rodou; rodou no braço.

Cai dentro do recorte que este documento diz ser o único que sobreviveu: **drift da doc humana, determinístico, sem LLM. Ninguém no mercado faz.**

### A regra estrutural que sai daqui

Toda regra depende de um **elo spec ↔ issue ↔ PR**. No `REVIEW.md` esse elo não existia e foi **chutado por nome e data** (`~#40–#50`, *"confirmar no git log antes de citar"*) — é a origem de todo o erro. A ferramenta reproduziria o mesmo erro pela mesma razão.

> **O drift nunca infere o elo spec↔entrega.** Ele o lê como **`fato`** (`refs #N` no PR), o recebe como **`asserção`** (ADR-013 — o dono confirmou, com autor, data e `sha`), ou o declara **`não rastreável`**. **Nunca como `inferência`.** A heurística de nome/data pode alimentar a **pergunta** ("o PR #103 foi este?"), jamais a **resposta** exibida como status.

Isso reaproveita o ADR-013 sem inventar nada: reconstruir um elo perdido é um clique, e o resultado é asserção versionada em `docs/CONTEXT.md` — que apodrece com validade explícita ("a revalidar") em vez de mentir em silêncio.

### Granularidade: por fatia, não por repo

**Decisão do PI (2026-07-14): drift é feature de repo gerenciado** — o elo só é fato onde o processo (`refs #N`) foi seguido.

**Correção necessária**: se o gate for o **repo**, o produto nasce sem nenhum lugar onde rodar (só o `rrb-proplan` é gerenciado hoje) e exclui justamente o **projeto parado**, que é o alvo declarado do produto. O gate é a **fatia**: o mesmo repo pode ter 12 fatias rastreáveis e 38 não. Daí sai a métrica exibida — **"Rastreabilidade: 12 de 50 fatias"**, com CTA de reconstrução do elo. O número **sobe conforme o dono responde**: é o ativo do ADR-013 com um medidor, e transforma o legado de lixo em fila de trabalho finita e opcional.

### Pendências antes de virar spec

- Formalizar a regra do elo (`fato` | `asserção` | `não rastreável`) — **ADR novo ou adendo ao ADR-012**? Decisão do PI.
- Onde a rastreabilidade aparece: Visão Geral (alerta) ou aba própria.
- O `REVIEW.md` do repo-alvo tem um segundo uso, independente deste: **insumo de importação única do board** (os ✅ entram como **Feito** = `open` + `proplan:done`, *nunca* Finalizado — ninguém aceitou nada). Fluxo já previsto para `STATUS.md` legado na `CONVENTION.md`.

---

## Gatilhos de revisão

Revisitar este documento **imediatamente** se qualquer um destes acontecer — cada um derruba uma premissa acima:

- [ ] **GitHub estender o Copilot Memory para citar `docs/`** (e não só código) → o diferencial #1 evapora. **É o risco de plataforma mais alto que temos.**
- [ ] Swimm, Mintlify ou Promptless passarem a ler `docs/` markdown **solto** (sem formato proprietário) e detectar contradição.
- [ ] Cortex/Port/OpsLevel adicionarem **frescor/contradição de doc** aos scorecards (hoje só checam existência).
- [ ] O GitHub MCP oficial passar a expor **julgamento** ("qual a próxima issue e por quê"), não só listagem.
- [ ] Aparecer produto comercial focado em **retomar projeto parado**.

**Revisão de rotina**: a cada 6 meses. Próxima → **2027-01**.
