---
proplan: v1
spec: SPEC-003
fatia: 3
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-003 — Insight: resumo de estado, bootstrap de STATUS.md e configuração de IA

## Objetivo

O momento "projeto esquecido → entendimento em 1 minuto": abrir o workspace e ver **o que é, onde parou, o que falta** — saber **se dá pra confiar no que está escrito** — e, para projeto sem `STATUS.md`, receber uma proposta gerada por IA para revisar e commitar sem sair do ProPlan.

## Escopo

- **Configurações — provedor de IA** (decisão do PI em 2026-07-12; vira ADR-008):
  - Tela de Configurações (ícone engrenagem no rail) com seleção do provedor padrão: Anthropic (padrão), OpenAI, OpenRouter. Persistida na tabela `settings` (linha única por usuário — sem hardcode).
  - Arquitetura: interface `LlmClient` no domínio do `insight` + dois adapters HTTP: Anthropic e OpenAI-compatível (serve OpenAI e OpenRouter, que usam o mesmo formato).
  - Provedor sem chave no `.env` aparece desabilitado no menu com aviso — nunca selecionável pra quebrar em runtime. Modelo por provedor definido em config (env), não na UI, nesta fatia.
- **Configurações — limiar de defasagem de docs** (ADR-010): campo numérico "Alertar quando o código estiver à frente dos docs por mais de ___ dias", **padrão 90**, mesma tabela `settings`. `0` desliga o alerta (a UI passa a só exibir as duas datas, sem ⚠️).
- **Alerta de documentação defasada** (ADR-010) — determinístico, **sem IA**:
  - No fim de cada `sync-job` (sucesso, inclusive `noop`), duas chamadas à Commits API: último commit em `docs` e último commit do repo. Persistidas em `Project.lastDocsCommitAt` / `Project.lastCodeCommitAt` (+ `commitMetaSyncedAt`).
  - Falha dessas chamadas **não falha o sync** — campos ficam nulos, sync segue `success`, e a UI omite o bloco (não mostra erro).
  - Repo sem commit em `docs` → `lastDocsCommitAt` nulo → trata-se como "sem documentação", não como defasagem.
- **Módulo `insight`** (novo):
  - Job BullMQ `insight` disparado quando um sync termina com `docs_scope_hash` novo (evento in-process `DocsSynced`).
  - **Resumo de estado** (artefato interno, sem commit): entrada = `README.md` + `CLAUDE.md` + docs da convenção; saída = JSON `{ oQueE, ondeParou, oQueFalta[] }` persistido em `insights` com `docs_tree_sha`, `provider`, `model`, `tokens`. Regenerado só quando o hash muda (ADR-002).
  - **Bootstrap de `STATUS.md`**: para projeto sem `docs/STATUS.md` conforme convenção, gerar proposta no formato exato do `CONVENTION.md`. ⚠️ **Superseded pela SPEC-005 (ADR-011, 2026-07-12)**: o bootstrap passa a **propor cards → criar Issues**, não escrever um `STATUS.md`. O endpoint `POST /projects/:id/bootstrap/status/commit` é substituído por `POST /projects/:id/board/bootstrap` + `/apply`. Entregue como está na Fatia 3; migrado na Fatia 5.
  - Cap de custo por execução: limite de tokens de entrada; docs truncados por prioridade README > CLAUDE > STATUS > demais.
- **Write-back (antecipado da Fatia 5, nasce aqui)**: commit de arquivo via GitHub Contents API com SHA base; 409/conflito → re-sync e uma retentativa; persiste → erro claro na UI. Mensagem: `proplan: bootstrap de STATUS.md`.
- **Web — aba Visão Geral** (ativa): blocos "O que é / Onde parou / O que falta", badge `inferido por IA` (âmbar), botão **Regenerar com dialog de confirmação** (avisa custo de tokens; força re-run auditado), estado "gerando…".
- **Web — faixa de frescor** (topo da Visão Geral, acima dos três blocos, ADR-010): sempre exibe `Docs: <relativo> · Código: <relativo>` (ex.: "Docs: há 14 meses · Código: há 3 meses"). Ultrapassado o limiar, a faixa fica âmbar com **⚠️ Documentação possivelmente defasada** e um texto explicando o cálculo. Dentro do limiar (ou limiar `0`), fica neutra/cinza, sem ícone. **Não bloqueia nada** — é sinal, não gate.
- **Web — fluxo bootstrap**: projeto sem STATUS.md mostra CTA "Gerar proposta de STATUS.md" → editor com preview markdown na UI → "Aprovar e commitar" → commit direto no branch default → re-sync automático.

## Fora de escopo

Kanban interativo (Fatia 5), arestas semânticas (Fatia 7), bootstrap dos demais docs da convenção (fatias das abas), streaming de resposta, seleção de modelo na UI, teste de conectividade da chave na tela de Configurações.

Do ADR-010, ficam de fora: **defasagem por documento** (badge em cada aba — só o sinal global do projeto nesta fatia), **coluna de defasagem no catálogo** (só na Visão Geral), e **SBOM / dependency graph** (autorizado no adendo ao ADR-003, mas exige spec própria pós-MVP — tem a ressalva do dependency graph desabilitado por padrão em repo privado).

## Critérios de aceite

- [ ] Configurações mostra os três provedores; os sem chave no `.env` aparecem desabilitados com aviso; a escolha persiste (recarregar mantém).
- [ ] Com Anthropic padrão, abrir workspace de projeto sincronizado mostra Visão Geral com os três blocos e badge de IA.
- [ ] Trocar o provedor padrão faz a próxima inferência usar o novo provedor (verificável em `insights.provider`).
- [ ] Sync sem mudança de docs não gera nova chamada de IA; Regenerar com confirmação gera e fica auditado.
- [ ] Projeto sem STATUS.md: CTA → editor com preview → commit no GitHub com mensagem padrão → STATUS.md aparece no repo e re-sync o traz pro ProPlan.
- [ ] Editar o STATUS.md no GitHub entre gerar e commitar (conflito de SHA) resulta em re-sync + aviso — nunca sobrescrita silenciosa.
- [ ] Falha do provedor deixa a Visão Geral com erro amigável + "Tentar de novo"; demais abas seguem funcionando; nenhuma chamada de IA em caminho de renderização.
- [ ] **Defasagem (ADR-010)**: projeto com docs velhos e código recente além do limiar mostra a faixa âmbar com ⚠️ e as duas datas; projeto com docs recentes mostra a faixa neutra sem ícone.
- [ ] **Defasagem**: baixar o limiar em Configurações (ex.: 90 → 7) faz a faixa mudar de estado **sem novo sync** — o limiar é comparação em leitura, não valor gravado.
- [ ] **Defasagem**: limiar `0` remove o ⚠️ e mantém as duas datas visíveis.
- [ ] **Defasagem**: repo sem nenhum commit em `docs` não mostra alerta de defasagem (mostra o estado "sem documentação"); falha da Commits API deixa o sync `success` e a faixa simplesmente não aparece.

## Contratos

- Prisma novo: `Settings { id, userId único, llmProvider anthropic|openai|openrouter, docsStalenessThresholdDays Int @default(90) }` · `Insight { id, projectId, kind summary|status_bootstrap, docsTreeSha, provider, model, inputTokens, outputTokens, content Json, createdAt }`.
  - ⚠️ **`Insight.inputTokens`/`outputTokens` NÃO são contabilidade de custo** (ADR-016). `Insight` é **cache de artefato** chaveado por `docsTreeSha`: não registra chamadas que falharam, nem o retry de JSON inválido, nem proposta de bootstrap descartada, e perde o gasto antigo ao regenerar. Somar essas colunas **subestima** o gasto. O registro real é o ledger `LlmUsage` — **Fatia 7.5 (SPEC-009)**.
- Prisma alterado: `Project` ganha `lastDocsCommitAt DateTime?`, `lastCodeCommitAt DateTime?`, `commitMetaSyncedAt DateTime?` (ADR-010).
- Env novo: `LLM_MODEL_ANTHROPIC` (default claude-sonnet), `LLM_MODEL_OPENAI`, `LLM_MODEL_OPENROUTER`.
- API: `GET/PUT /settings` (inclui `docsStalenessThresholdDays`) · `GET /projects/:id/insights/summary` · `POST /projects/:id/insights/summary/regenerate` · `POST /projects/:id/bootstrap/status` (gera proposta) · `POST /projects/:id/bootstrap/status/commit` (body: conteúdo revisado).
- `GET /projects/:id/freshness` → `{ lastDocsCommitAt, lastCodeCommitAt, thresholdDays, stale: boolean }`. `stale` é **calculado na leitura** comparando as datas com o limiar corrente — nunca persistido, senão mudar o limiar exigiria re-sync.
- `insight` consome `IngestionService` (re-sync pós-commit) e `AuthService.githubTokenOf` — só interfaces públicas.

## Notas técnicas

- Write-back antecipado: o mecanismo de commit+conflito criado aqui é o mesmo que a Fatia 5 (Kanban) reusa — implementar no `board`? Não: nasce em `insight/infrastructure` e sobe pra um shared do domínio quando a Fatia 5 precisar (regra: não criar abstração antes do segundo consumidor).
- Prompt do resumo deve exigir saída JSON estrita (schema no prompt + validação; retry 1x em JSON inválido).
- OpenRouter usa o endpoint OpenAI-compatível com `baseURL` própria — mesmo adapter, config diferente.
- **Defasagem (ADR-010)**: onde mora o código? A coleta é metadado de repositório, não inferência — **nasce no `ingestion`** (`GithubGitClient` ganha `getLastCommitDate(path?)`; `SyncService` grava os campos no fim do run). O `insight` **não** participa. A composição do endpoint `/freshness` (juntar as datas do `Project` com o limiar do `Settings`) fica no `catalog`, que já é dono do `Project`.
- **Defasagem — não persistir `stale`**: gravar o booleano no banco criaria estado que só se atualiza no próximo sync, e mudar o limiar em Configurações não teria efeito visível. É comparação de leitura, ponto.
- **Defasagem — `path=docs`**: a Commits API aceita prefixo de diretório. Não usar `docs/` com barra final (comportamento inconsistente em alguns casos); usar `docs`. Repo cujos docs estão só na raiz (`README.md`) e não em `docs/` retorna vazio — cai no caso "sem documentação".

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-12: menu de configuração com provedor padrão (Anthropic default) ✔ · revisão na UI + commit direto ✔ · Regenerar com confirmação ✔ · alerta de defasagem global (2 requests), limiar configurável na UI com padrão 90 dias, persistência em colunas de `Project`, adendo ao ADR-003 cobrindo também SBOM (autorizado, não implementado) ✔
