---
proplan: v1
spec: SPEC-031
fatia: 20
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovado pelo PI em 2026-07-26
updated: 2026-07-26
---
# SPEC-031 — Briefing público: 9 etapas, rascunho retomável, versão imutável (Fatia 20, MVP3)

> Segunda fatia da Frente Clientes (`docs/specs/MVP3.md`). As 8 decisões fundadoras do PI (2026-07-25) estão lá — esta spec as assume, não as rediscute. A **SPEC-029** entregou o ciclo de vida do link (`BriefingLink`, `GET /b/:token`, rate limit, auditoria) e a página `/b/:token` que hoje só diz *"o formulário estará disponível aqui em breve"*. **Esta fatia é esse formulário.**

## Objetivo

O cliente do prestador abre o link que recebeu, responde 9 etapas sem ter conta, pode parar e voltar depois, e ao enviar produz uma `BriefingVersion` **imutável** que move o card no funil e fica legível para o prestador.

## Escopo

### 1. Formulário público de 9 etapas (módulo `briefing`)

Página React em `/b/:token` (a rota já existe, fora do gate de sessão — FIX #136), sem sessão, sem cookie. Uma etapa por tela, navegação livre para trás, avanço bloqueado por validação da etapa corrente. As 9 etapas e o que cada uma coleta:

| # | etapa | campos | consome depois |
|---|---|---|---|
| 1 | Contexto do negócio | empresa/nome, segmento, estado, cidade, produtos/serviços (catálogo curado, §3) | `BriefingNormalizer`, contrato |
| 2 | Objetivo | problema a resolver, resultado esperado, definição de sucesso | `ScopeAnalyst` |
| 3 | Público e referências | quem usa, URLs de referência/concorrentes, o que agrada/desagrada em cada | `ScopeAnalyst`, `SitePromptGenerator` |
| 4 | Solução e funcionalidades | tipo (site institucional · landing · e-commerce · sistema web · app), funcionalidades desejadas | `RequirementPrioritizer`, `EffortEstimator` |
| 5 | Conteúdo e identidade | quem fornece textos/imagens/logo, domínio existente, redes, anexos (§4) | `EffortEstimator` — *quem produz o quê muda horas* |
| 6 | Integrações e técnica | pagamento, WhatsApp, ERP/sistema atual, e-mail, hospedagem existente, dados pessoais/LGPD | `EffortEstimator` |
| 7 | Prazo e orçamento | data desejada, urgência, faixa de orçamento (**opcional**) | `EffortEstimator`, contrato |
| 8 | Modalidade preferida | desenvolvimento · +manutenção · +venda do código | **preferência, nunca vinculante** (MVP3 §2 decisão 8) |
| 9 | Complexidade, revisão e envio | nível baixa/média/alta + revisão de todas as respostas + confirmação | MVP3 §2 decisão 7 |

Regras do formulário:

- **Etapa 9 nunca cita modelo de IA** — só *baixa/média/alta*, com uma frase explicando o que cada nível significa para o cliente (profundidade da análise, não marca de modelo). O mapeamento nível→modelo é configuração interna do workspace e **não entra nesta fatia**.
- **Etapa 8 é declarada como preferência na própria tela** — o texto diz que a modalidade final é definida na proposta. Prometer o contrário criaria expectativa que a estimativa (SPEC-032) vai quebrar.
- **Toda entrada validada no servidor**, com o mesmo schema usado no cliente. Validação de tela é conveniência; a barreira é a API.
- Campo obrigatório vs. opcional é decidido por etapa e explícito na spec de implementação: só as etapas 1, 2, 4 e 9 têm campos obrigatórios; as demais podem ser enviadas vazias (**ausência é informação**, ADR-014 — o pipeline recebe "não informado", nunca um valor inventado).

### 2. Rascunho retomável no servidor (`BriefingDraft`)

- Salvamento automático ao avançar de etapa e a cada 30 s de inatividade dentro da etapa.
- Chave: `briefingLinkId` (derivado do hash do token) — **um rascunho por link**. Reabrir o link em outro aparelho retoma de onde parou.
- Guarda a etapa corrente e as respostas parciais em `jsonb`. Rascunho **não** é versão: nada nele é entrada do pipeline.
- Primeiro save de rascunho move o card `LINK_SENT → BRIEFING_STARTED` (transição de sistema, `actorUserId = null` — o schema já permite).
- Revogar ou expirar o link **congela** o rascunho: ele permanece no banco, deixa de aceitar escrita, e a tela mostra o mesmo texto não-diferencial de link inválido.

### 3. Catálogo curado de produtos/serviços e localidades (Etapa 1)

Fecha a pergunta aberta do **MVP3 §10** (decisão do PI, 2026-07-26):

- **Produtos/serviços**: lista curada própria por segmento (`ServiceCatalogItem`, raiz com `tenant_id`), com seed inicial e edição no workspace. O cliente escolhe da lista **e** pode acrescentar item livre — o que ele digita não polui o catálogo do tenant, fica só na resposta.
- **Estados e cidades**: dados do IBGE **embarcados via seed**, não consumidos em runtime. Motivo: o formulário público estaria refém de uma API externa no caminho do cliente — IBGE fora do ar viraria briefing travado. Atualização é reseed, tarefa de manutenção, não de request.
- **Segmento**: lista de segmentos derivada de CNAE no seed, mesma justificativa.

### 4. Anexos (`FileAsset`, decisão do PI 2026-07-26)

Upload público existe nesta fatia, com restrição dura — é a superfície mais exposta do produto inteiro:

- **Onde**: bytes no Postgres, sob RLS, herdando isolamento e backup do banco (**ADR novo**, §Notas técnicas). Migrar para bucket depois é cópia, não redesenho.
- **Limites**: 10 MB por arquivo, 25 MB e 5 arquivos por briefing, aplicados no servidor.
- **Allowlist de MIME**: `image/png`, `image/jpeg`, `image/webp`, `application/pdf`. Nada mais.
- **Tipo verificado pelo conteúdo** (assinatura de bytes), nunca pelo `Content-Type` do request nem pela extensão.
- **Nome seguro gerado pelo servidor**; o nome original é guardado como metadado exibível, jamais usado como caminho.
- **Download só autenticado, no painel do prestador**, por URL assinada de vida curta, servido com `Content-Disposition: attachment` e `Content-Type` fixo do allowlist. O cliente que enviou não relista nem baixa — ele já tem o arquivo.
- Cada upload gera `AuditEvent`.

### 5. Envio: `BriefingVersion` imutável

- Confirmação explícita na Etapa 9, com o aviso de que **depois do envio nada pode ser alterado** (nem pelo prestador, nem pela IA — MVP3 §1, mesmo espírito do ADR-013).
- O submit grava `BriefingVersion` (respostas normalizadas em `jsonb`, anexos referenciados, número de versão sequencial por `ClientProject`), emite o evento in-process `BriefingSubmitted` e move o card `BRIEFING_STARTED → BRIEFING_SUBMITTED`.
- **Idempotência** por (`briefingLinkId`, `contentHash`): reenviar o mesmo conteúdo devolve a mesma versão, não cria a segunda. Duplo clique e retry de rede não produzem dois briefings.
- Depois do submit o rascunho é marcado como **consumido** (não apagado — a linha fica, como no link revogado) e o link passa a responder *"briefing recebido"*: não reabre o formulário nem devolve as respostas.
- **Regenerar o link** (SPEC-029) permite um novo briefing: nasce versão 2, e a versão 1 **permanece**. Versão nunca é sobrescrita.

### 6. Leitura no painel do prestador

Sem isto a fatia entrega um backend sem consumidor — a lição registrada no FIX #134:

- No detalhe do projeto de cliente (gaveta da SPEC-030/FIX #134): estado do briefing (não iniciado · em preenchimento com % de etapas · recebido em *data*).
- Visualização **somente leitura** da `BriefingVersion`: as 9 etapas com as respostas, anexos baixáveis, seletor quando houver mais de uma versão.
- `viewer` lê; ninguém edita — não existe rota de escrita sobre `BriefingVersion` em nenhum papel.

## Fora de escopo

- Pipeline de IA, artefatos, aprovação humana (SPEC-032) — o evento `BriefingSubmitted` fica **sem consumidor** nesta fatia, de propósito.
- Estimativa, contratos, dashboard (SPEC-033…035).
- Notificar o prestador por e-mail/WhatsApp quando o briefing chegar (MVP3 §3: notificações são YAGNI até doerem).
- Editar resposta após o envio, em qualquer papel. Não é "ainda não": é proibido.
- Mapear nível de complexidade → modelo de IA (configuração de workspace, chega com a SPEC-032).
- Múltiplos respondentes simultâneos no mesmo link (último save vence; sem edição colaborativa).
- Tradução/i18n do formulário; PDF do briefing; assinatura do cliente.

## Critérios de aceite

**Formulário e navegação**

- [ ] Abrir `/b/:token` válido **sem sessão** (janela anônima) → renderiza a Etapa 1; nenhuma requisição da página envia cookie de sessão (conferível na aba Network).
- [ ] As 9 etapas existem, na ordem da tabela do §1, com um indicador de progresso (`Etapa N de 9`).
- [ ] Tentar avançar com campo obrigatório vazio → bloqueia com mensagem no campo; forçar o avanço pela API → **422**, e nada é gravado.
- [ ] Voltar para uma etapa anterior preserva o que já foi respondido.
- [ ] Etapa 9 exibe os três níveis de complexidade com explicação em linguagem de cliente e **nenhum nome de modelo** aparece na tela nem na resposta da API (conferível no payload).
- [ ] Etapa 8 declara em tela que a modalidade é preferência e será confirmada na proposta.

**Rascunho**

- [ ] Preencher até a Etapa 4, fechar o navegador, reabrir o link **em outro aparelho** → volta na Etapa 4 com as respostas anteriores.
- [ ] O primeiro save move o card para *Briefing* no funil, com `ClientStatusTransition` de `LINK_SENT` para `BRIEFING_STARTED` e `actorUserId` nulo.
- [ ] Revogar o link enquanto há rascunho → a tela passa a responder o texto de link inválido; `PATCH` no rascunho → **404/410 não-diferencial**; a linha do rascunho continua no banco (conferível por query).

**Etapa 1 — catálogo e localidades**

- [ ] Selecionar estado filtra as cidades daquele estado; nenhuma requisição sai para domínio do IBGE em runtime (conferível na aba Network).
- [ ] Produtos/serviços listam o catálogo do tenant dono do link; adicionar item livre grava na resposta e **não** cria linha em `ServiceCatalogItem`.

**Anexos**

- [ ] Enviar PNG de 1 MB → aceito e listado. Enviar arquivo de 11 MB → **413**, nada gravado.
- [ ] Enviar um `.exe` renomeado para `.pdf` (assinatura de bytes não confere) → **415**, nada gravado, `AuditEvent` de rejeição.
- [ ] Sexto arquivo no mesmo briefing → recusado com mensagem de limite.
- [ ] Baixar anexo pelo painel autenticado → responde `Content-Disposition: attachment` e o `Content-Type` do allowlist. Pedir o mesmo arquivo **sem sessão** ou de **outro tenant** → mesma resposta de não encontrado (não-diferencial).

**Envio e imutabilidade**

- [ ] Enviar → `BriefingVersion` v1 criada, `BriefingSubmitted` emitido, card em *Briefing* com estado `BRIEFING_SUBMITTED`, transição gravada.
- [ ] Clicar enviar duas vezes (ou repetir o `POST`) → **uma única** `BriefingVersion` no banco.
- [ ] Reabrir o link após o envio → tela de "briefing recebido", sem formulário e sem as respostas.
- [ ] Não existe rota que altere `BriefingVersion` — provado por teste que varre as rotas do módulo (nenhum `PATCH`/`PUT`/`DELETE` sobre a entidade).
- [ ] Regenerar o link e enviar de novo → v2 criada; v1 continua legível no painel.

**Isolamento**

- [ ] Todas as rotas públicas derivam o tenant do **hash do token**; nenhum payload aceita `workspaceId`/`tenantId` (teste que envia o campo prova que ele é ignorado).
- [ ] Com o role de aplicação do Postgres e **sem** `app.tenant_ids` no contexto, `SELECT` em `briefing_drafts`, `briefing_versions` e `file_assets` devolve **zero linhas** (fail-closed, mesmo padrão de `clients-rls.int-spec.ts`).
- [ ] Rate limit em **todas** as rotas públicas de escrita (rascunho, anexo, submit), não só no `GET` da SPEC-029 → **429** ao exceder (limite e janela registrados na implementação).

**Painel**

- [ ] Gaveta do projeto mostra o estado do briefing (não iniciado · em preenchimento com progresso · recebido em *data*) e abre a versão em leitura.
- [ ] `viewer` consegue ler o briefing e baixar anexo; nenhum papel tem controle de edição.

## Contratos (assinaturas, não implementação)

**Públicas** (sem sessão, fora de `JwtAuthGuard`/`TenantGuard`, tenant pelo hash do token, rate-limited, respostas não-diferenciais):

- `GET /b/:token` → `{ status: valid|expired|revoked|invalid|submitted, step?, answers?, catalog? }` (estende a rota da SPEC-029)
- `PATCH /b/:token/draft { step, answers }` → salva parcial
- `POST /b/:token/attachments` (multipart) → `{ id, name, size, mime }`
- `DELETE /b/:token/attachments/:id` → remove anexo do rascunho (antes do submit)
- `POST /b/:token/submit { confirm: true }` → `{ versionId, version }`, idempotente por `contentHash`

**Autenticadas** (painel):

- `GET /t/:tenant/client-projects/:id/briefing` → estado + lista de versões
- `GET /t/:tenant/briefing-versions/:id` → versão em leitura
- `GET /t/:tenant/files/:id` → download por URL assinada
- `GET/POST/PATCH/DELETE /t/:tenant/service-catalog` → curadoria do catálogo (`owner`/`member`; `viewer` só lê)

**Modelo**:

- `BriefingDraft{ briefingLinkId (único), step, answers jsonb, updatedAt }`
- `BriefingVersion{ clientProjectId, briefingLinkId, version, answers jsonb, contentHash, submittedAt }` — **sem coluna de atualização; nenhuma rota de escrita**
- `FileAsset{ tenantId, briefingVersionId?, briefingDraftId?, name, safeName, mime, size, bytes, createdAt }`
- `ServiceCatalogItem{ tenantId, segment, label, active }`
- Evento in-process: `BriefingSubmitted{ clientProjectId, briefingVersionId }` — **sem consumidor nesta fatia**

## Notas técnicas

- **ADR novo — anexo de cliente vive no Postgres sob RLS.** A `DEPLOY.md` §8 deixa claro que não há object storage ativo (Supabase reservado). Guardar bytes no banco com limite duro compra isolamento por RLS e backup junto do resto; o custo é inchaço do banco, aceito enquanto os limites forem estes. O ADR precisa dizer **qual gatilho** força a revisão (ex.: passar de X GB, ou o primeiro upload acima do limite atual).
- **Rota pública abre o próprio `withTenant`** depois de resolver o link, exatamente como a `/b/:token` da SPEC-029 e a `/resolve` do ADR-020. Nenhuma das rotas públicas entra no `TenantContextInterceptor`.
- **`BriefingLinkPage` não usa o `request()` do `lib/api`** (FIX #136): `request()` trata 401 como "precisa logar" e quem responde o briefing nunca vai ter conta. Manter `fetch` cru e a regra de que **429 e 5xx não viram "link inválido"**.
- **Transições de sistema**: `actorUserId` nullable já existe no schema (`ClientStatusTransition`) e foi criado exatamente para este caso — não inventar usuário-robô.
- **A máquina de estados continua no `domain/`** do módulo `clients`. O `briefing` pede a transição pelo service público; não escreve em `client_projects` (ADR-001).
- **`BriefingSubmitted` sem consumidor é intencional.** A alternativa — segurar o evento até a SPEC-032 — faria a fatia seguinte mexer em duas coisas ao mesmo tempo.
- **Rate limit**: o `SlidingWindowRateLimiter` atual é em memória, por instância. Serve para uma instância na Railway; se a API escalar horizontalmente, o limite vira por-réplica. Registrar como risco conhecido, não resolver aqui.
- **Teste de ponta a ponta é obrigatório** nesta fatia (lição do FIX #134): pelo menos um teste percorre *abrir link → preencher → salvar → retomar → enviar → ler no painel*. Teste de lógica com fixture não prova que existe caminho até a lógica.
- O **dogfooding no navegador** é parte da entrega, não apêndice: a SPEC-029 atravessou dois FIX porque nenhuma tela foi aberta.

## Perguntas abertas

Nenhuma. As quatro decisões que faltavam foram resolvidas com o PI em 2026-07-26 e estão incorporadas acima:

1. Conteúdo das 9 etapas → tabela do §1, confirmada.
2. Produtos/serviços da Etapa 1 (pendência do MVP3 §10) → catálogo curado por segmento, editável pelo workspace.
3. Anexos → **dentro** desta fatia, com restrição dura (§4).
4. Rascunho → **no servidor**, retomável pelo mesmo link em qualquer aparelho.
5. Storage de anexo → **Postgres sob RLS**, com ADR próprio.

Bloqueador novo descoberto na implementação volta ao PI antes de virar código.
