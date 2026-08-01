---
proplan: v1
spec: SPEC-042
fatia: 31
status: aprovada-pi
updated: 2026-08-01
---
# SPEC-042 — Licensing: e-mail da chave entrega a compra (download público + manual)

## Objetivo

O e-mail da chave passa a entregar a compra completa — chave, link de download e manual — eliminando a dependência da área de membros da Kiwify para a primeira instalação.

## Escopo

- `LicProduct` ganha `downloadUrl` e `manualUrl` (opcionais), editáveis na área de licenciamento do admin (tela de produto que a SPEC-040 já criou).
- Template `license_key` v2: chave + passo a passo em 3 passos (baixar → instalar → ativar) + aviso do SmartScreen (o binário não é assinado; explicar evita o comprador achar que é vírus) + link do manual. Blocos condicionais: produto sem URL configurada → e-mail idêntico ao atual, sem placeholder nem link quebrado.
- `webhook-processor` passa as URLs do produto ao `mail.send`.
- Checklist operacional da fatia (não é código do ProPlan, mas é critério de pronto): repo GitHub **público** `war-room-releases` criado, com a release 1.0.2 publicada (setup.exe + zip + `SHA256SUMS.txt`); `downloadUrl` do produto = `.../war-room-releases/releases/latest`.

## Fora de escopo

- Fluxo source (templates `source_*` intocados).
- Página `/download` no site war-room-web (pode vir depois; é outro repo).
- Endpoint de download autenticado por chave — **rejeitado pelo PI em 2026-08-01** (link público escolhido; o gate real é a licença).
- Reenvio do e-mail da chave (regra da SPEC-036 permanece: reemitir revoga a anterior).
- Assinatura de código do binário.

## Critérios de aceite

- [ ] Admin edita `downloadUrl`/`manualUrl` de um `LicProduct` e os valores persistem.
- [ ] Compra aprovada via webhook gera e-mail contendo: chave, link de download, link do manual, os 3 passos e o aviso do SmartScreen.
- [ ] Produto sem URLs configuradas → e-mail sem os blocos novos (nenhum link quebrado ou texto órfão).
- [ ] Testes de template cobrem as duas variantes (com e sem URLs).

## Contratos

- Prisma: `LicProduct.downloadUrl String?`, `LicProduct.manualUrl String?`.
- `LicenseKeyData` += `downloadUrl: string | null`, `manualUrl: string | null`.
- Rota de admin de atualização de produto existente passa a aceitar os dois campos.

## Notas técnicas

- Decisões do PI (2026-08-01): hospedagem em repo público `war-room-releases`; link sempre `releases/latest`; URLs por **produto** (multi-tenant preservado — nada de env var); e-mail com passo a passo + SmartScreen.
- A chave continua não persistida; o template muda, a regra de reemissão não.
- A URL `latest` desacopla o template do ciclo de release: publicar versão nova não toca o ProPlan. O cadastro em `LicRelease` continua servindo só ao `war-room update` (SPEC-041) — são dois canais distintos de propósito: primeira entrega é pública, atualização é autorizada por licença.

## Perguntas abertas

Nenhuma — as quatro decisões acima foram resolvidas com o PI em 2026-08-01.
