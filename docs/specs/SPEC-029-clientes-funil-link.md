---
proplan: v1
spec: SPEC-029
fatia: 19
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-25
---
# SPEC-029 — Clientes, projetos de cliente, funil Kanban e ciclo de vida do link público (Fatia 19, MVP3)

> Primeira fatia da Frente Clientes (`docs/specs/MVP3.md`). As 8 decisões fundadoras do PI (2026-07-25) estão registradas lá — esta spec as assume, não as rediscute.

## Objetivo

O prestador cadastra clientes, cria projetos de cliente, acompanha cada projeto num funil Kanban de 4 colunas e gera/gerencia o link público de briefing — tudo isolado por tenant. (O **formulário** público de briefing é a Fatia 20/SPEC-030; aqui entra só o ciclo de vida do link.)

## Escopo

1. **Módulo `clients`** (novo, monolito NestJS, estrutura padrão `presentation/application/domain/infrastructure`):
   - `Client`: nome, CPF, empresa, CNPJ, e-mail, telefone, WhatsApp, endereço completo (CEP, logradouro, bairro, cidade, estado), notas internas. CRUD + busca (nome, empresa, CNPJ). Exclusão **lógica**.
   - `ClientProject`: título, descrição, cliente (N projetos por cliente), estado interno do funil. **Nunca** reusar a tabela `Project` (repos) — colisão de nome resolvida no MVP3 §4.
   - **Funil**: colunas *Novo/Link enviado · Briefing · Prompt e contrato · Produção e entrega*; estados internos `DRAFT → LINK_SENT → BRIEFING_STARTED → BRIEFING_SUBMITTED → ARTIFACTS_READY → CONTRACT_PENDING → CONTRACT_APPROVED → IN_PRODUCTION → DELIVERED → ARCHIVED`. Máquina de estados no `domain/` valida transições **no servidor**; cada mudança grava `ClientStatusTransition` (de, para, ator, timestamp).
   - **UI**: página Clientes (lista/detalhe/formulário), página Kanban (dnd-kit, já na stack) com drag-and-drop, atualização otimista com rollback quando o servidor recusar a transição, busca por cliente/empresa/projeto.
2. **Módulo `briefing` — só o ciclo de vida do link**:
   - Ao criar `ClientProject`, gerar `BriefingLink`: token 256-bit exibido **uma única vez**; persiste **apenas o hash** (SHA-256). Ações: copiar, definir expiração, revogar, regenerar (revoga o anterior).
   - Rota pública `GET /b/:token` (sem sessão): valida token por hash, registra o **acesso** e responde o estado do link (válido/expirado/revogado) — o formulário em si é SPEC-030. Rate limiting por IP+token. O tenant é derivado do **hash do token** (lookup global próprio, padrão da rota `/resolve`, ADR-020) — **nunca** de `workspaceId` no request.
   - Registrar criação, acesso, envio (futuro) e revogação como `AuditEvent`.
3. **Infra `AuditEvent`** (append-only): entidade compartilhada da frente, nasce aqui com os eventos de link e de transição de funil.
4. **Tenancy**: `Tenant.installationId` vira **nullable** (migration); tela de criação de workspace sem GitHub **não** entra nesta fatia — o tenant pessoal existente já serve. Novas tabelas raiz (`Client`) com `tenant_id` + policy RLS; filhas (`ClientProject`, `BriefingLink`, `ClientStatusTransition`, `AuditEvent`) por join — mesmo desenho da SPEC-022. Toda query sob `withTenant` (regra 2026-07-22, `ARCHITECTURE.md` → Resiliência).
5. **ADRs**: registrar os dois ADRs do MVP3 §8 (funil no banco delimitando o ADR-011; `installationId` nullable).
6. **RBAC** (papéis da SPEC-022): `owner`/`member` criam/editam/movem; `viewer` só lê — UI esconde **e** API recusa (defesa em profundidade).

## Fora de escopo

- Formulário público de briefing, etapas, salvamento parcial (SPEC-030).
- Pipeline de IA, artefatos, estimativa, contratos, dashboard (SPEC-031…034).
- Notificações; criação de workspace sem GitHub; billing.
- Importação de clientes; integração com CRM externo.

## Critérios de aceite

**Clientes e projetos**

- [ ] Setup: tenant A com membro autenticado. Ação: criar cliente com todos os campos e dois projetos. Resultado: cliente aparece na busca por nome, empresa e CNPJ; os dois projetos listam no detalhe do cliente; ambos nascem em `DRAFT`, coluna *Novo/Link enviado*.
- [ ] Excluir cliente é lógico: some das listas, linhas permanecem no banco (conferível por query) e o histórico do funil não é apagado.

**Funil**

- [ ] Mover card por drag-and-drop entre colunas válidas → a UI atualiza otimista; o servidor valida a transição e grava `ClientStatusTransition` com de/para/ator/quando (conferível na trilha do projeto).
- [ ] Transição **inválida** (ex.: `DRAFT` → `IN_PRODUCTION`) forçada via API → **422**, card **volta** à posição anterior na UI (rollback observável), nenhuma transição gravada.
- [ ] Busca no Kanban filtra por cliente, empresa e título do projeto.

**Link público**

- [ ] Gerar link → token completo exibido uma única vez; no banco existe **só o hash** (conferível por query — nenhuma coluna contém o token em claro).
- [ ] `GET /b/:token` com token válido → 200 com estado do link e `AuditEvent` de acesso gravado; token revogado → resposta de revogado, sem vazar existência de tenant/projeto; token expirado → idem; token inexistente → mesma resposta de inválido (não-diferencial).
- [ ] Regenerar → link antigo passa a responder revogado; novo funciona; ambos os eventos auditados.
- [ ] Rate limit: exceder o limite em `GET /b/:token` → **429** (limite e janela registrados na implementação).

**Isolamento e RBAC**

- [ ] Membro do tenant A não vê cliente/projeto/link do tenant B em nenhuma rota (lista, detalhe, busca, Kanban) — provado com RLS ativa, sem bypass.
- [ ] Com o role de aplicação do Postgres e **sem** `app.tenant_ids` no contexto, `SELECT` direto em `clients`/`client_projects` devolve **zero linhas** (fail-closed).
- [ ] `viewer`: UI sem controles de criar/editar/mover **e** `POST`/`PATCH` → 403.

**Tenancy**

- [ ] Migration aplicada: `Tenant.installationId` aceita NULL; nenhum comportamento existente do catálogo/sync quebra (regressão dos testes atuais verde).

## Contratos (assinaturas, não implementação)

- `POST /t/:tenant/clients` · `GET /t/:tenant/clients?q=` · `GET/PATCH/DELETE /t/:tenant/clients/:id`
- `POST /t/:tenant/clients/:id/projects` · `GET /t/:tenant/client-projects?board=1` (composição do Kanban)
- `POST /t/:tenant/client-projects/:id/transition { to }` → valida máquina de estados; `GET /t/:tenant/client-projects/:id/history`
- `POST /t/:tenant/client-projects/:id/briefing-link` (gera/regenera) · `DELETE …/briefing-link` (revoga) · `PATCH …/briefing-link { expiresAt }`
- **Pública**: `GET /b/:token` → `{ status: valid|expired|revoked|invalid }`
- Modelo: `Client{ tenantId, … , deletedAt }` · `ClientProject{ clientId, state }` · `BriefingLink{ clientProjectId, tokenHash, expiresAt?, revokedAt? }` · `ClientStatusTransition{ clientProjectId, from, to, actorUserId, at }` · `AuditEvent{ tenantId, kind, subject, payload jsonb, at }` (append-only)
- Evento in-process: `ClientProjectTransitioned` (consumidores futuros: dashboard, notificações).

## Notas técnicas

- **ADR-011 intocado** para o board de repos; o funil de clientes é domínio disjunto (ADR novo do MVP3 §8). O teste de arquitetura que protege o ADR-011 não deve disparar aqui — se disparar, o teste está medindo o domínio errado.
- **Token**: 32 bytes CSPRNG, base64url; comparação por hash em tempo constante. Sem JWT — link não carrega claims, é opaco.
- Rota pública fica **fora** de `TenantGuard`/`TenantContextInterceptor` e abre o próprio `withTenant` após resolver o link — não-diferencial em erros (mesma resposta para inexistente/alheio), como `/resolve`.
- Estados avançados do funil (`BRIEFING_SUBMITTED`+) são alcançáveis por transição manual nesta fatia; a automação (submit do briefing move o card) chega na SPEC-030.
- CEP/endereço: sem integração ViaCEP nesta fatia (campo manual); avaliar na SPEC-030 junto das APIs do briefing.

## Perguntas abertas

Nenhuma no momento — as decisões estruturais estão no MVP3 §2. Bloqueadores novos devem ser trazidos ao PI antes de codificar.
