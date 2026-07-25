---
proplan: v1
spec: MVP3
fatia: 19+
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovado pelo PI em 2026-07-25
updated: 2026-07-25
---
# MVP3 — Frente Clientes: briefing → artefatos comerciais e técnicos

Documento de escopo do MVP3. **Não é uma fatia** — é o guarda-chuva que define a tese, as decisões fundadoras, o modelo de dados e a ordem das fatias 19+. Cada bloco vira uma SPEC própria antes de ser codificado.

> **Pré-condição**: nenhuma fatia do MVP3 começa sem a respectiva SPEC `aprovada-pi`. As fatias do MVP3 não dependem do MVP2 (frentes paralelas por decisão do PI, se ele assim ordenar no board).

---

## 1. Tese

> O ProPlan ganha uma segunda frente: transformar **briefings de clientes** em **artefatos comerciais e técnicos** — análise estruturada, escopo, estimativa, prompts de desenvolvimento/precificação/contrato, arquivos e histórico auditável.

**Não é um CRM nem um formulário com Kanban.** O núcleo de valor é a **transformação segura e versionada** das informações do briefing em entregáveis reutilizáveis:

- a resposta do cliente é **imutável** depois do envio — nem IA, nem prestador a alteram (mesmo espírito do ADR-013: a asserção humana é sagrada);
- todo entregável de IA é **versionado com o insumo que o gerou** (mesmo padrão do ADR-002/SPEC-011: inferência carimbada pela entrada, idempotente por `input_hash`);
- "regenerar" **cria versão nova, nunca sobrescreve**;
- contrato e estimativa são **snapshots congelados** — editar o template nunca muda contrato existente (mesmo princípio do ADR-016: custo congelado na escrita).

## 2. Decisões fundadoras (PI, 2026-07-25)

| # | decisão | escolha do PI | consequência |
|---|---|---|---|
| 1 | Stack | **NestJS + React/Vite atuais** — nada de Next.js/Server Components | Reusa RLS, identity, BullMQ, ledger de IA e todos os ADRs. Princípios "adaptadores finos" viram: controllers/use cases finos, regra de negócio no `domain/` |
| 2 | Produto | **Módulos novos dentro do monolito ProPlan** (ADR-001) | Mesmo deploy Railway, mesmo painel; extração futura continua sendo decisão futura |
| 3 | Tenancy | **Evoluir o `Tenant` existente** — `installationId` vira *nullable* | "Workspace" é nome de UI do `Tenant`. Uma tenancy, um RLS (ADR-020), uma `Membership`. Tenant existe sem GitHub (coerente com SPEC-025/026: conexão ⊥ identidade). Exige ADR |
| 4 | Kanban de clientes | **Estado no banco do app** — variação consciente do ADR-011, restrita a este domínio | ADR-011 continua valendo para o board de **repos**; o funil de clientes é entidade do app com `StatusTransition` auditada. Exige ADR delimitando os dois domínios |
| 5 | Fatiamento | F1 Clientes+funil+link → F2 Briefing público → F3 Pipeline IA → F4 Estimativa → F5 Contratos → F6 Dashboard | Ordem de dependência real; ver §9 |
| 6 | Provedor IA | **Só Anthropic no 1º corte** (ADR-008: provedor configurável, Anthropic padrão) | Tiers baixa=Sonnet, média=Opus, alta=Fable. OpenAI entra depois como 2º provedor do ADR-008 |
| 7 | Etapa 9 do briefing | Cliente escolhe **nível de complexidade** (baixa/média/alta), nunca nome de modelo | Mapeamento nível→modelo é configuração interna do workspace; briefing não envelhece a cada geração de modelo |
| 8 | Modalidade de serviço | **Cliente indica preferência no briefing; prestador decide** na estimativa; contrato congela | A escolha do cliente é dado de entrada, nunca vinculante |

## 3. Módulos novos

Mesma estrutura por módulo (`presentation/`, `application/`, `domain/`, `infrastructure/`); comunicação por services públicos e eventos in-process — nunca importar entidade interna de outro módulo (ADR-001).

| Módulo | Responsabilidade | Não faz |
|---|---|---|
| `clients` | Cliente (nome, CPF, empresa, CNPJ, e-mail, telefone, WhatsApp, endereço completo, notas internas), `ClientProject`, funil Kanban (4 colunas / 10 estados internos), `ClientStatusTransition` auditada, busca | Falar com GitHub; tocar o board de repos (ADR-011) |
| `briefing` | Link público (token 256-bit, **só o hash persiste**, expiração/revogação/regeneração, rate limit), rascunho parcial com retomada, 9 etapas, `BriefingVersion` **imutável** no submit, evento `BriefingSubmitted` | Alterar resposta após submit; confiar em `workspaceId` vindo do cliente |
| `artifacts` | Orquestrador do pipeline (§6) em jobs BullMQ; saída estruturada validada por schema; artefato versionado com aprovação humana; idempotência por (`briefing_version_id`, `kind`, `input_hash`) | IA em caminho de request (ADR-002); sobrescrever versão; inventar dado ausente; ferramenta fora da allowlist |
| `estimates` | Cálculo **determinístico** (horas × valor/h, cenários otimista/provável/pessimista, nominal 10h/dia **e realista 6-8h produtivas**, custos de IA/hospedagem/banco/storage/serviços/contingência, planejamento de MVPs e issues); parâmetros configuráveis por workspace (padrão: R$ 200/h, BRL, Brasil) | Deixar LLM fazer aritmética de preço; referência de mercado sem fonte+região+data (sem isso: **"referência não verificada"**) |
| `contracts` | `ProviderProfile` (dados sensíveis **mascarados em UI e logs**); template com placeholders (`{{provider_name}}`, `{{client_name}}`, `{{scope}}`, `{{budget}}`, `{{date}}`, `{{deadline}}`, `{{payment_terms}}`) versionado a cada edição; contrato = **snapshot imutável** de prestador+cliente+escopo+valor+template; link público próprio com registro de acesso; disclaimer de revisão jurídica humana; modalidades explícitas (desenvolvimento / +manutenção / +venda de código) | Mudar contrato existente quando o template edita; assinar ou aprovar por IA |
| `files` | Upload com limite de tamanho, allowlist de MIME, nome seguro, URL assinada, verificação de conteúdo, proteção contra execução, rastreabilidade | Servir binário como executável |

**Infra compartilhada**: `AuditEvent` (append-only, desde a F1). **Notifications**: fora do 1º corte (YAGNI) — entra na F6 se doer. **Dashboard**: query de composição sobre os módulos, não é módulo.

## 4. Modelo de dados mínimo

Entidades (identificadores em inglês, UUID, timestamps UTC, exclusão lógica onde fizer sentido, índices compostos por tenant):

`Client` · `ClientProject` · `BriefingLink` · `BriefingDraft` · `BriefingVersion` (respostas normalizadas em `jsonb`, imutável) · `Artifact` (+ versões) · `AiExecution` (metadados de execução; o **custo** vive no ledger do ADR-016) · `Estimate` · `ContractTemplate` · `ContractTemplateVersion` · `Contract` · `FileAsset` · `ClientStatusTransition` · `AuditEvent` · `ProviderProfile`.

Regras transversais:

- **Colisão de nome**: o ProPlan já tem `Project` (repo GitHub). A entidade desta frente é **`ClientProject`** — nunca reusar a tabela existente.
- **Isolamento**: mesmas três barreiras da SPEC-022 — escopo na aplicação, **RLS** (raízes com `tenant_id`: `Client`, `ContractTemplate`, `ProviderProfile`, `FileAsset`…; filhas por join), teste de auditoria no CI. Toda query sob `withTenant` (regra de 2026-07-22 na `ARCHITECTURE.md`).
- **Tenant nunca vem do cliente**: rota autenticada deriva da sessão; rota pública deriva do **hash do token** do link (lookup global próprio, mesmo padrão da rota `/resolve` do ADR-020) — jamais de um `workspaceId` no payload.
- **Operações críticas idempotentes**: submit de briefing, geração de artefato, criação de contrato — chave natural + `input_hash`.

## 5. Funil (Kanban de clientes)

Colunas: **1 Novo/Link enviado · 2 Briefing · 3 Prompt e contrato · 4 Produção e entrega**.

Estados internos (mais finos que as colunas): `DRAFT` → `LINK_SENT` → `BRIEFING_STARTED` → `BRIEFING_SUBMITTED` → `ARTIFACTS_READY` → `CONTRACT_PENDING` → `CONTRACT_APPROVED` → `IN_PRODUCTION` → `DELIVERED` → `ARCHIVED`.

Transições validadas **no servidor** (máquina de estados no `domain/`); drag-and-drop com atualização otimista e rollback; cada mudança gera `ClientStatusTransition` (de, para, ator, quando).

## 6. Pipeline de IA (agentic controlado — nunca "AGI autônoma")

Capacidades isoladas: `BriefingNormalizer` → `ScopeAnalyst` → `RequirementPrioritizer` → `EffortEstimator` → `SitePromptGenerator` → `ContractComposer` → `ArtifactReviewer`.

O orquestrador: carrega **uma versão específica** do briefing → valida dados mínimos → executa capacidades em jobs BullMQ → exige saída estruturada por schema → grava modelo, versão do prompt, tokens, custo e duração (ledger ADR-016, teto por tenant) → cria artefato versionado → **solicita aprovação humana** → permite reprocessamento idempotente.

A IA **não pode**: alterar respostas originais; acessar dados de outro tenant; assinar contratos; aprovar estimativas; inventar informações ausentes; executar ferramenta fora da allowlist. Preferir função determinística para cálculo, validação e renderização — não introduzir múltiplos agentes autônomos sem ganho mensurável.

## 7. Ordem das fatias (de-para provisório)

| Fatia | SPEC | entrega |
|---|---|---|
| 19 | SPEC-029 | Clientes + projetos de cliente + funil Kanban + ciclo de vida do link público |
| 20 | SPEC-030 | Briefing público: 9 etapas, salvamento parcial, versão imutável, `BriefingSubmitted` |
| 21 | SPEC-031 | Pipeline de IA + artefatos versionados + aprovação humana |
| 22 | SPEC-032 | Estimativa de desenvolvimento (determinística + decomposição por IA) |
| 23 | SPEC-033 | Contratos: perfil do prestador, templates versionados, snapshot, link público |
| 24 | SPEC-034 | Dashboard/resumo operacional do funil (+ notificações, se doerem até lá) |

Ao aprovar cada spec, registrar o par no **Índice Fatia ↔ SPEC** do `docs/STATUS.md` (fonte única).

## 8. ADRs a criar (na F1)

1. **Funil de clientes é estado do app** — delimita o ADR-011: Issues são a fonte de estado do board de **repos**; o funil de clientes vive no banco com `ClientStatusTransition`. Nenhum fato mora nos dois lugares.
2. **`Tenant.installationId` nullable** — tenant existe sem instalação GitHub; catálogo e sync tratam ausência como informação (mesma semântica de `Connection` ausente na SPEC-025).

## 9. Regras não-negociáveis (herdadas do pedido do PI, 2026-07-25)

- Toda entrada externa validada; respostas humanas nunca alteradas por geração de IA; artefatos/contratos/templates/respostas versionados; nenhuma estimativa ou preço de mercado inventado; decisões irreversíveis em ADR; regra de negócio nunca em página, componente ou handler.

## 10. Perguntas abertas

- **Etapa 1 do briefing — "API free para pesquisa de produtos/serviços"**: estados/cidades = IBGE Localidades (free, sem chave); segmento = CNAE/IBGE. Para **produtos/serviços** não há fonte gratuita óbvia — proposta: lista curada própria por segmento, editável pelo workspace. Decidir na SPEC-030.
- Numeração de fatia 19–24 é provisória até o PI validar contra o board.
