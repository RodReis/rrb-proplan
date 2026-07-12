---
proplan: v1
spec: SPEC-003
fatia: 3
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-003 — Insight: resumo de estado, bootstrap de STATUS.md e configuração de IA

## Objetivo

O momento "projeto esquecido → entendimento em 1 minuto": abrir o workspace e ver **o que é, onde parou, o que falta** — e, para projeto sem `STATUS.md`, receber uma proposta gerada por IA para revisar e commitar sem sair do ProPlan.

## Escopo

- **Configurações — provedor de IA** (decisão do PI em 2026-07-12; vira ADR-008):
  - Tela de Configurações (ícone engrenagem no rail) com seleção do provedor padrão: Anthropic (padrão), OpenAI, OpenRouter. Persistida na tabela `settings` (linha única por usuário — sem hardcode).
  - Arquitetura: interface `LlmClient` no domínio do `insight` + dois adapters HTTP: Anthropic e OpenAI-compatível (serve OpenAI e OpenRouter, que usam o mesmo formato).
  - Provedor sem chave no `.env` aparece desabilitado no menu com aviso — nunca selecionável pra quebrar em runtime. Modelo por provedor definido em config (env), não na UI, nesta fatia.
- **Módulo `insight`** (novo):
  - Job BullMQ `insight` disparado quando um sync termina com `docs_scope_hash` novo (evento in-process `DocsSynced`).
  - **Resumo de estado** (artefato interno, sem commit): entrada = `README.md` + `CLAUDE.md` + docs da convenção; saída = JSON `{ oQueE, ondeParou, oQueFalta[] }` persistido em `insights` com `docs_tree_sha`, `provider`, `model`, `tokens`. Regenerado só quando o hash muda (ADR-002).
  - **Bootstrap de `STATUS.md`**: para projeto sem `docs/STATUS.md` conforme convenção, gerar proposta no formato exato do `CONVENTION.md`.
  - Cap de custo por execução: limite de tokens de entrada; docs truncados por prioridade README > CLAUDE > STATUS > demais.
- **Write-back (antecipado da Fatia 5, nasce aqui)**: commit de arquivo via GitHub Contents API com SHA base; 409/conflito → re-sync e uma retentativa; persiste → erro claro na UI. Mensagem: `proplan: bootstrap de STATUS.md`.
- **Web — aba Visão Geral** (ativa): blocos "O que é / Onde parou / O que falta", badge `inferido por IA` (âmbar), botão **Regenerar com dialog de confirmação** (avisa custo de tokens; força re-run auditado), estado "gerando…".
- **Web — fluxo bootstrap**: projeto sem STATUS.md mostra CTA "Gerar proposta de STATUS.md" → editor com preview markdown na UI → "Aprovar e commitar" → commit direto no branch default → re-sync automático.

## Fora de escopo

Kanban interativo (Fatia 5), arestas semânticas (Fatia 7), bootstrap dos demais docs da convenção (fatias das abas), streaming de resposta, seleção de modelo na UI, teste de conectividade da chave na tela de Configurações.

## Critérios de aceite

- [ ] Configurações mostra os três provedores; os sem chave no `.env` aparecem desabilitados com aviso; a escolha persiste (recarregar mantém).
- [ ] Com Anthropic padrão, abrir workspace de projeto sincronizado mostra Visão Geral com os três blocos e badge de IA.
- [ ] Trocar o provedor padrão faz a próxima inferência usar o novo provedor (verificável em `insights.provider`).
- [ ] Sync sem mudança de docs não gera nova chamada de IA; Regenerar com confirmação gera e fica auditado.
- [ ] Projeto sem STATUS.md: CTA → editor com preview → commit no GitHub com mensagem padrão → STATUS.md aparece no repo e re-sync o traz pro ProPlan.
- [ ] Editar o STATUS.md no GitHub entre gerar e commitar (conflito de SHA) resulta em re-sync + aviso — nunca sobrescrita silenciosa.
- [ ] Falha do provedor deixa a Visão Geral com erro amigável + "Tentar de novo"; demais abas seguem funcionando; nenhuma chamada de IA em caminho de renderização.

## Contratos

- Prisma novo: `Settings { id, userId único, llmProvider anthropic|openai|openrouter }` · `Insight { id, projectId, kind summary|status_bootstrap, docsTreeSha, provider, model, inputTokens, outputTokens, content Json, createdAt }`.
- Env novo: `LLM_MODEL_ANTHROPIC` (default claude-sonnet), `LLM_MODEL_OPENAI`, `LLM_MODEL_OPENROUTER`.
- API: `GET/PUT /settings` · `GET /projects/:id/insights/summary` · `POST /projects/:id/insights/summary/regenerate` · `POST /projects/:id/bootstrap/status` (gera proposta) · `POST /projects/:id/bootstrap/status/commit` (body: conteúdo revisado).
- `insight` consome `IngestionService` (re-sync pós-commit) e `AuthService.githubTokenOf` — só interfaces públicas.

## Notas técnicas

- Write-back antecipado: o mecanismo de commit+conflito criado aqui é o mesmo que a Fatia 5 (Kanban) reusa — implementar no `board`? Não: nasce em `insight/infrastructure` e sobe pra um shared do domínio quando a Fatia 5 precisar (regra: não criar abstração antes do segundo consumidor).
- Prompt do resumo deve exigir saída JSON estrita (schema no prompt + validação; retry 1x em JSON inválido).
- OpenRouter usa o endpoint OpenAI-compatível com `baseURL` própria — mesmo adapter, config diferente.

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-12: menu de configuração com provedor padrão (Anthropic default) ✔ · revisão na UI + commit direto ✔ · Regenerar com confirmação ✔
