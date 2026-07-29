---
proplan: v1
spec: MVP4
fatia: 25+
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovado pelo PI em 2026-07-29
updated: 2026-07-29
---
# MVP4 — Frente Licenciamento: keys, ativações e assinaturas dos produtos do tenant

Documento de escopo do MVP4. **Não é uma fatia** — é o guarda-chuva que define a tese, as decisões fundadoras, o modelo de dados e a ordem das fatias 25+.

> **Pré-condição**: nenhuma fatia do MVP4 começa sem a respectiva SPEC `aprovada-pi`. As fatias do MVP4 não dependem do MVP2/MVP3 (frentes paralelas), exceto onde indicado (tenancy da SPEC-022, padrão de rota pública da SPEC-031).

> **Origem**: SPEC de licenciamento do War Room (`docs/MODELO-DE-NEGOCIO.md` §5 daquele repo), adaptada ao ProPlan nesta frente. **Piloto: War Room** — 1º produto com keys gerenciáveis.

---

## 1. Tese

> O ProPlan ganha uma terceira frente: **administrar o pós-venda dos produtos de software do tenant** — licenças, ativações por máquina, assinaturas e revogação em tempo real (modelo Keygen.sh/Lemon Licensing, self-hosted no monolito).

**Visão maior (não especificada agora):** esta frente é o primeiro passo de "gestão de projetos como um todo" — projeto que é só licenciamento (War Room), projeto desenvolvido para cliente após proposta fechada no funil do MVP3, projeto com assinatura recorrente. A costura fica registrada aqui (`LicProduct.projectId?` opcional) e volta como frente própria quando houver segundo caso real.

Premissa herdada da spec de origem: **a proteção atrasa, não impede.** O mecanismo real é contrato + conveniência de updates. Nenhum dado da sessão do produto do cliente sai da máquina dele — só eventos de licença.

Decisão central de desenho: **validação por assinatura, não por segredo.** O servidor assina um *license file* com chave privada Ed25519; o cliente valida com a chave pública embutida no binário. Offline funciona pela validade do arquivo assinado (graça de 14 dias renovada por heartbeat), não por confiança no relógio do servidor.

## 2. Decisões fundadoras (PI, 2026-07-29)

| # | decisão | escolha do PI | consequência |
|---|---|---|---|
| 1 | Onde vive | **Módulo `licensing` no monolito** (ADR-001, mesma decisão #2 do MVP3) | Mesmo deploy Railway, mesma RLS, mesmo painel. Extração futura é decisão futura — a fronteira de módulo é o pré-requisito |
| 2 | Tenancy | **Por tenant, com RLS** (ADR-020) | `tenantId` em todas as tabelas `Lic*`. Licenciamento é capacidade do produto ProPlan, não módulo pessoal do dono |
| 3 | Modelo comercial | **`billingModel: PERPETUAL \| SUBSCRIPTION` desde o schema** | Perpétua = produto nunca expira, `updatesUntil` limita updates. Assinatura = `expiresAt` renovado a cada pagamento; inadimplência → degradado. Fluxo de renovação implementado na fatia de webhooks |
| 4 | Trial | **Sem trial.** Venda direta: R$ 39,99 (edição fechada/binário) e R$ 129,99 (edição source) | Endpoint `/trial` e `kind: TRIAL` **fora do produto**. Se voltar, é fatia nova com spec própria. Preço vive no checkout da plataforma, **não no schema** — o valor pago chega pelo webhook e fica no `LicEvent.payload` |
| 5 | Edição source | Convite ao repo privado **no 8º dia** após a compra (vencido o prazo legal de arrependimento de 7 dias, CDC art. 49) | Job diário; reembolso/chargeback antes do dia 8 cancela o convite; depois, remove o colaborador |
| 6 | Plataforma de venda | **Kiwify primeiro**, atrás de um adapter por plataforma (HMAC/token + idempotência por `saleRef`) | Hotmart/Lemon Squeezy entram como novos adapters, sem tocar o domínio |
| 7 | E-mail transacional | **Resend**, módulo `mail` compartilhado atrás de interface | Envio da chave e avisos. SPF/DKIM/DMARC no DNS são critério de aceite. Trocar provider = trocar adapter |
| 8 | Convite GitHub | **PAT fine-grained dedicado** (`administration:write` só no repo do produto), secret do módulo | Não expande as permissões do GitHub App (ADR-015) nem exige re-consent das instalações |
| 9 | Cliente de licença | **Fora do ProPlan.** A máquina de estados do cliente (LICENSED/GRACE/DEGRADED) vive no repo do War Room | O ProPlan publica o contrato (license file + API `/licensing/v1`); o War Room implementa o consumidor. Nenhuma fatia daqui produz código de outro repo |

## 3. Módulos novos

| Módulo | Responsabilidade | Não faz |
|---|---|---|
| **licensing** | Produtos/edições licenciáveis do tenant; emissão e revogação de licenças (chave exibida 1×, armazenada em hash); ativações por máquina (fingerprint); assinatura Ed25519 do license file (com `kid` para rotação); webhooks da plataforma de venda; job do convite GitHub; trilha `LicEvent`; métricas para o admin | Guardar a chave em claro; receber dados da sessão do produto do cliente; implementar o cliente de licença; guardar preço como fonte (a plataforma é a fonte) |
| **mail** | Envio transacional atrás de interface (`MailService.send`), adapter Resend | Template marketing/newsletter; fila própria (usa BullMQ existente) |

Fronteira (regra de 2026-07-29 do `ARCHITECTURE.md`): se o `dashboard` ou outro compositor quiser métricas de licenciamento, o módulo exporta `licensing-summary.service.ts` — o compositor não recebe `PrismaService`.

## 4. Modelo de dados (deltas sobre a spec de origem)

Schema da spec de origem (`LicProduct`, `LicEdition`, `License`, `Activation`, `LicEvent`) com estes deltas:

- **`tenantId`** em `LicProduct`, `License`, `Activation` e `LicEvent` (denormalizado onde a política RLS precisar), políticas conforme ADR-020.
- **`LicEdition.billingModel`**: `PERPETUAL | SUBSCRIPTION`. `License.expiresAt` vale para `SUBSCRIPTION` (renovado por webhook de pagamento). `trialDays` **removido**.
- **`LicKind` removido** (era `PAID | TRIAL`) — sem trial, toda licença é paga.
- **`LicProduct.projectId?`** opcional → costura futura com o catálogo (produto licenciado ↔ repo/projeto).
- **Prefixo da chave** (`WR-XXXX-…`) derivado de `LicProduct.keyPrefix`, não hardcoded.
- **`LicEvent.type`** ganha eventos de assinatura: `webhook_renewed`, `webhook_overdue`, `webhook_canceled`.

## 5. Contrato com o cliente de licença (publicado, estável)

- **API pública** `/licensing/v1`: `POST /activate`, `POST /heartbeat`, `POST /deactivate` — autenticadas pela própria chave, rate-limited. Erros canônicos: `404` chave inexistente · `410` revogada/expirada · `409` limite de máquinas (com lista de ativações para troca self-service).
- **License file** (retorno de activate/heartbeat): `{ payload: { licenseId, edition, billingModel, fingerprint, issuedAt, updatesUntil, expiresAt, signedAt, graceDays: 14, kid }, signature: base64(ed25519) }`. O cliente valida assinatura + fingerprint + relógio; validade offline = `signedAt + graceDays`; heartbeat renova `signedAt`.
- Mudança neste contrato depois do piloto = versão nova (`/v2`), nunca quebra do `/v1`.

## 6. Ordem das fatias

| Fatia | SPEC | Entrega | Critério-chave |
|---|---|---|---|
| 25 | SPEC-036 | Schema + RLS + chaves Ed25519 + emissão manual no admin + `POST /activate` + license file assinado | Ativar uma chave em máquina real e receber arquivo válido |
| 26 | SPEC-037 | `/heartbeat`, `/deactivate`, limite de máquinas com troca self-service | 3ª máquina recebe `409` com lista; desativar libera |
| 27 | SPEC-038 | Módulo `mail` (Resend) + webhook Kiwify (compra, reembolso, chargeback, renovação, inadimplência) | Compra sandbox emite chave por e-mail; reembolso revoga; renovação estende `expiresAt` |
| 28 | SPEC-039 | Job do convite GitHub (dia 8, PAT dedicado) + revogação de colaborador | Compra source gera convite agendado; reembolso cancela; revogação remove colaborador |
| 29 | SPEC-040 | Painel admin completo + métricas (ativações/dia, vendas, reembolsos, assinaturas ativas/inadimplentes) | Buscar, revogar, estender, desativar máquina pelo painel |

Dependência externa (fora do board do ProPlan): cliente de licença no repo do War Room (estados, graça, degradado, CLI) — implementado contra o contrato da §5, testável a partir da Fatia 25.

## 7. Segurança e LGPD

- Chave privada Ed25519 só no servidor (secret do Railway); license file carrega `kid` — o cliente aceita 2 chaves públicas durante rotação.
- Rate limit em `/activate` por IP e por chave; webhook com validação de assinatura da plataforma e idempotência por `saleRef`.
- Dados pessoais mínimos (e-mail, nome do comprador); finalidade declarada; rota de exclusão a pedido. **Revisar termos com advogado** (ressalva herdada da spec de origem).
- `fingerprint` é hash — o servidor nunca recebe MAC em claro; `hostname` é opcional e só para exibição.

## 8. Riscos aceitos (registrados, sem mitigação técnica)

- Comprador técnico pode remover a checagem do binário — aceito por premissa (proteção atrasa, não impede).
- Clone do repo source roda sem DRM — mecanismo é contratual.
- Graça de 14 dias favorece o usuário honesto por design; abuso em escala aparece nas métricas do admin (ativações anômalas por chave).
- E-mail transacional em provider gratuito (Resend free tier) — suficiente para o volume do piloto; limite vira alerta operacional, não bloqueio de venda (chave também aparece no admin).

## 9. Perguntas abertas do MVP4

**Resolvidas com o PI em 2026-07-29:**

1. **Webhook Kiwify em dev** (Fatia 27): **túnel** (cloudflared/ngrok) apontando para a API local, para exercício manual. Os testes automatizados usam **fixtures gravadas** dos payloads — CI nunca depende de túnel nem da Kiwify. Setup documentado na SPEC-038.
2. **Conta GitHub do comprador source** (Fatia 28, decisão delegada ao Cowork): **e-mail pós-compra com link único** (token derivado da licença) para uma página pública mínima onde o comprador informa o username GitHub; o servidor valida a existência do usuário via GitHub API antes de gravar. Sem username no dia 8 → o job **não convida** e a pendência fica visível no admin; fallback: o admin grava o username manualmente. Escolhido por não depender de campo custom no checkout — portável para Hotmart/Lemon Squeezy. Detalhamento na SPEC-039.
3. **Portal self-service** (`GET /portal/:key` da spec de origem): fora das fatias 25–29; entra como fatia própria se houver demanda real de suporte.
