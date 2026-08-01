---
proplan: v1
spec: SPEC-043
fatia: 32
status: aprovada-pi
updated: 2026-08-01
---
# SPEC-043 — Licensing: relatos de erro do app (opt-in)

## Objetivo

Bug do app licenciado em produção chega ao ProPlan com contexto suficiente para diagnóstico e retorno ao comprador — hoje não existe canal nenhum (o único tráfego externo do War Room é licenciamento).

Esta spec cobre o **lado servidor + admin**. O lado cliente (captura, consentimento, comando `war-room report`) está pareado em `war-room/docs/specs/SPEC-relatos-de-erro.md`.

## Escopo

- Modelo `LicErrorReport`: tenant, licença (resolvida por `keyHash`), `appVersion`, `os`, `occurredAt`/`receivedAt`, `message`, `stack`, `sessionTail` (Json), `source` (`crash` | `manual`), `userNote?`, `contactEmail?`, `status` (`new` | `triaged` | `resolved`).
- `POST /licensing/v1/errors` (público): exige chave **válida** (keyHash existente e não revogado) — chave inválida → 401; rate limit próprio (padrão do webhook: fora do limite geral, com limite dedicado); cap de payload de 256 KB com **truncamento** (sessionTail primeiro) — nunca rejeição por tamanho.
- Aba de erros na área de licenciamento do admin (SPEC-040): lista com filtros (produto, versão, status), agrupamento por `message` com contagem, detalhe com stack + sessionTail + dados da licença — **e-mail do comprador via correlação server-side**.
- Purge automático: relatos com mais de **90 dias** são apagados (job recorrente).
- A exclusão de dados a pedido (SPEC-040) passa a cobrir `LicErrorReport`.

## Fora de escopo

- Métricas de uso / analytics (só erros e feedback).
- Alertas ou notificações de erro novo.
- Resposta automática ao comprador.
- Captura no lado cliente (spec pareada no repo war-room).

## Critérios de aceite

- [ ] `POST /errors` com chave válida persiste o relato completo; chave inválida ou revogada → 401.
- [ ] Payload acima do cap é truncado e aceito (sessionTail primeiro); nunca 413.
- [ ] Admin lista, filtra e agrupa; detalhe mostra o e-mail do comprador correlacionado pela licença.
- [ ] `contactEmail` informado num relato manual aparece no detalhe.
- [ ] Job de purge remove relatos com mais de 90 dias (teste com relógio controlado).
- [ ] Exclusão de dados a pedido remove/anonimiza os relatos da licença.

## Contratos

- `POST /licensing/v1/errors` — body: `{ licenseKey, appVersion, os, occurredAt, message, stack, sessionTail?, source, userNote?, contactEmail? }` → `202 { received: true }`.
- Prisma: `LicErrorReport` (índices: `tenantId+status`, `licenseId`, `message`).

## Notas técnicas

- Decisões do PI (2026-08-01): opt-in perguntado na ativação com **padrão NÃO**; conteúdo completo com sessionTail; correlação com o comprador; crash automático + comando manual; visualização na área de licensing; chave válida obrigatória; retenção 90 dias.
- **O e-mail do comprador não trafega do cliente** — o app nem conhece o e-mail da compra. A correlação `keyHash → License → e-mail` acontece no servidor. `contactEmail` é outra coisa: e-mail digitado voluntariamente pelo usuário no relato manual, para retorno de feedback.
- **Risco aceito (PI, 2026-08-01):** `sessionTail` contém nomes de arquivos e trechos de atividade do projeto do usuário. Mitigações obrigatórias: consentimento explícito descrevendo exatamente isso (lado cliente), cap de tamanho, retenção 90 dias e exclusão a pedido.
- Dado pessoal sob LGPD (correlação com comprador + contactEmail): minimização via purge e cobertura pela exclusão a pedido já existente.

## Perguntas abertas

Nenhuma — resolvidas com o PI em 2026-08-01.
