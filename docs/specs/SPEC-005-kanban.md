---
proplan: v1
spec: SPEC-005
fatia: 5
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-005 — Kanban: gestão visual sobre STATUS.md

## Objetivo

Gerir o andamento do projeto movendo cards — com o repositório continuando dono do dado: todo movimento é um commit em `docs/STATUS.md` (ADR-005).

## Escopo

- **Módulo `board`** (novo):
  - **Parser/serializador de `STATUS.md`** conforme `CONVENTION.md`: 4 colunas fixas (Backlog, A Fazer, Em Andamento, Feito), cards como itens de lista, metadados `(prio: …)`, `(desde: …)`, `(em: …)`. **Round-trip fiel**: frontmatter, texto fora das seções e ordem dos cards preservados byte a byte no que não foi alterado.
  - **Mutações** (todas viram commit, mensagens padrão):
    - mover card → `proplan: move "<card>" para <coluna>` (mover para Feito adiciona `(em: <data>)`; para Em Andamento adiciona `(desde: <data>)`)
    - criar card → `proplan: adiciona "<card>" em <coluna>`
    - editar título/metadados → `proplan: edita "<card>"`
    - excluir card → `proplan: remove "<card>"`
  - **Write-back**: promover o mecanismo de commit da Fatia 3 (`insight/infrastructure`) para compartilhado (segundo consumidor — conforme nota da SPEC-003). Commit com SHA base; conflito → re-sync + reaplicar a mutação 1x; falha de novo → erro na UI com "Resolver no repo".
  - **Serialização por projeto**: mutações entram em fila (BullMQ `board`) processada em ordem — dois movimentos rápidos geram dois commits ordenados, nunca corrida. Melhoria futura registrada: squash de mutações em janela curta.
  - **Reconciliação sem webhook (ADR-009)**: re-sync automático após cada commit confirmado; botão Sincronizar cobre mudanças externas.
- **API**: `GET /projects/:id/board` (colunas+cards do último sync) · `POST /projects/:id/board/mutations` → `202 {mutationId}` (body: tipo + payload) · `GET /projects/:id/board/mutations/:mutationId` (estado: queued|committing|done|conflict|failed).
- **Web — aba Kanban** (ativa):
  - dnd-kit conforme `DESIGN.md`: drag com tilt/sombra, placeholder tracejado, soltar com spring; UI otimista + borda pulsante no card até o commit confirmar; toast success "Alterações salvas no repo" / erro persistente com ação (política de toasts do DESIGN.md).
  - Criar card inline no topo da coluna; editar em popover; excluir com confirmação.
  - Projeto sem `STATUS.md` → CTA "Gerar proposta com IA" (fluxo da Fatia 3).

## Fora de escopo

Webhooks/túnel (ADR-009), squash de commits, colunas customizadas, múltiplos assignees/labels (formato da convenção v1 é fixo), filtros e busca no board, WIP limits.

## Critérios de aceite

- [ ] Mover card na UI atualiza `docs/STATUS.md` no GitHub com a mensagem padrão; recarregar o ProPlan reflete o novo estado.
- [ ] Criar, editar e excluir card funcionam fim a fim com seus commits padrão.
- [ ] Round-trip: um STATUS.md com comentários/texto extra fora das seções passa por N mutações sem perder nem reordenar nada além do alterado (teste unitário obrigatório).
- [ ] Mover para Em Andamento/Feito carimba `(desde:)`/`(em:)` automaticamente.
- [ ] Conflito simulado (editar STATUS.md no GitHub entre carregar e mover) termina em re-sync + reaplicação — sem sobrescrita silenciosa; se a reaplicação falhar, erro claro.
- [ ] Duas mutações disparadas em sequência rápida geram dois commits na ordem correta (fila serializada).
- [ ] UI otimista: card muda de coluna imediatamente, pulsa até confirmar, toast só no resultado (nunca no gesto).

## Contratos

- `board` consome: parser próprio, `IngestionService.enqueueSync` (re-sync pós-commit), write-back compartilhado, `AuthService.githubTokenOf`.
- Sem tabela nova de cards — **o banco não guarda estado do board além do cache derivado dos documentos** (ADR-005: STATUS.md é a verdade). `BoardMutation { id, projectId, type, payload Json, status, error?, createdAt, finishedAt? }` apenas para auditoria/estado da fila.

## Notas técnicas

- O parser deve tolerar STATUS.md gerado fora do ProPlan (espaçamento/caixa variados nas seções) e normalizar na primeira serialização — commit de normalização explícito: `proplan: normaliza STATUS.md`.
- Identificação do card em mutação: coluna + índice + hash do texto no momento do load (evita ambiguidade com títulos duplicados); payload carrega os três.

## Perguntas abertas

Nenhuma. ADR-009 (sem webhook em ambiente local) decidido pelo planejamento em 2026-07-12 — reconciliação por re-sync pós-commit.
