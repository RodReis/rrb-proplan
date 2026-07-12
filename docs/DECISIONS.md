# Decisões Arquiteturais (ADRs)

Formato curto: contexto → decisão → consequências. Revisar o ADR antes de contrariá-lo.

## ADR-001 — Monolito modular, não microserviços

**Contexto**: usuário único no MVP, sem picos de carga, sem times independentes — nenhum dos motivadores de microserviços existe. Há intenção futura de SaaS.
**Decisão**: monolito NestJS com módulos DDD (`catalog`, `ingestion`, `insight`, `board`) comunicando-se por interfaces públicas e eventos in-process. Nada de gateway, service discovery ou Kafka.
**Consequências**: deploy e observabilidade triviais; disciplina de fronteira entre módulos é obrigatória (é ela que paga a extração futura). Risco aceito: acoplamento acidental se a disciplina falhar.

## ADR-002 — Híbrido por aba com inferência versionada por SHA

**Contexto**: as abas do workspace precisam de dados que não existem estruturados nos repos. Convenção pura exige disciplina em todos os projetos; inferência pura é cara e não-determinística.
**Decisão**: cada aba tem uma fonte primária declarada em `CONVENTION.md`. Documento da convenção existe → ele é a verdade. Não existe → inferência de IA como fallback, **sempre** persistida como artefato chaveado por `docs_tree_sha` e regenerada apenas quando o SHA muda. Proibido chamar IA no caminho de renderização.
**Consequências**: dashboard determinístico e barato após primeira ingestão; custo de IA proporcional a mudanças de docs, não a acessos. Artefato inferido pode ficar defasado da realidade do código — mitigado pelo bootstrap promover inferência a documento commitado e revisado.

## ADR-003 — Somente documentação, nunca clone de código

**Contexto**: requisito do produto ("não quero código") e economia — clones completos custam armazenamento, tempo e ampliam superfície de segurança.
**Decisão**: leitura exclusivamente via GitHub Git Trees + Contents API, restrita a `docs/`, `README.md`, `CLAUDE.md`, `.claude/`, `.github/workflows/`. `.claude/` e workflows entram porque alimentam as abas Skills & Agentes e Testes por parse determinístico, sem IA.
**Consequências**: ingestão leve e rápida; abas dependentes de código (ex.: cobertura real de testes) ficam limitadas ao que a documentação/CI declara. Limite aceito conscientemente.

## ADR-004 — BullMQ em vez de Kafka

**Contexto**: jobs assíncronos (sync, inferência) precisam de fila com retry. Kafka traria custo operacional (broker, particionamento, ops) sem consumidor além do próprio monolito.
**Decisão**: BullMQ sobre Redis (já presente para cache). Eventos de domínio in-process via `@nestjs/event-emitter`.
**Consequências**: infra mínima (Postgres + Redis). Se multi-tenant exigir streaming/fan-out real, este ADR deve ser revisado — o desacoplamento por eventos internos facilita a migração.

## ADR-005 — `STATUS.md` no repo-alvo como fonte de verdade do Kanban

**Contexto**: o Kanban precisa de fonte de verdade. Banco próprio criaria estado duplicado e divergente do repo; GitHub Issues/Projects acopla o produto a como cada projeto usa issues.
**Decisão**: `docs/STATUS.md` (formato em `CONVENTION.md`) é a verdade. Mover card = editar o MD + commit via Contents API com SHA base; webhook confirma e o índice local reconcilia. IA faz bootstrap do arquivo em projetos legados; o dono revisa e commita.
**Consequências**: o Kanban funciona em qualquer clone/editor (é só markdown), sobrevive ao próprio ProPlan e fica auditável no histórico git. Custo: latência de escrita (commit + webhook, UI otimista com `202`) e resolução de conflito por SHA (um retry automático; persiste → intervenção manual).

## ADR-006 — Stack: NestJS + React + PostgreSQL/Supabase + Redis

**Contexto**: stack dominada pelo dono; ecossistema Node com melhor suporte a Octokit/Anthropic; React tem as melhores libs para os dois componentes críticos (react-flow para grafo, dnd-kit para Kanban).
**Decisão**: NestJS (TypeScript) no back, React + Vite no front, PostgreSQL no Supabase, Redis para filas/cache. Auth do MVP: PAT do GitHub em variável de ambiente (usuário único). OAuth GitHub só com multi-tenant (módulo `identity`).
**Consequências**: uma linguagem no stack inteiro; Supabase dá Postgres gerenciado grátis no MVP e caminho de auth pronto para o futuro SaaS.
**Adendo (2026-07-12)**: a parte "PAT em variável de ambiente" foi substituída pelo ADR-007.

## ADR-007 — Login GitHub OAuth antecipado; PAT eliminado; Prisma como ORM

**Contexto**: o dono decidiu ter login desde a Fatia 1. Manter PAT + OAuth seria redundante: o token OAuth do usuário já lê os repos que o login autoriza.
**Decisão**: GitHub OAuth App (authorization code flow) desde a Fatia 1. Sessão = JWT em cookie httpOnly/SameSite=Lax. Token GitHub do usuário criptografado (AES-256-GCM, chave em env) na tabela `users`. Uma parte mínima do módulo `identity` nasce agora (login/logout/me); RBAC e multi-tenant continuam na Fatia 8. ORM: Prisma.
**Consequências**: sem PAT pra gerenciar; escopo `repo read` concedido no consentimento. Custo: criar OAuth App no GitHub e gerenciar 3 secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` + `JWT_SECRET`). Rodando local, o callback aponta pra `http://localhost:3000/auth/github/callback` e o front roda em `http://localhost:5180`.

## ADR-008 — Provedor de IA configurável, Anthropic como padrão

**Contexto**: o PI mantém chaves de Anthropic, OpenAI e OpenRouter e quer escolher o provedor sem mexer em código (decisão de 2026-07-12, SPEC-003).
**Decisão**: interface `LlmClient` no módulo `insight` com dois adapters HTTP — Anthropic e OpenAI-compatível (cobre OpenAI e OpenRouter, mesmo formato de API). Provedor padrão escolhido na tela de Configurações (tabela `settings`); Anthropic é o default. Modelo por provedor vem de env, não da UI. Provedor sem chave no env fica desabilitado no menu.
**Consequências**: troca de provedor sem redeploy; custo de manter dois formatos de client e prompts que funcionem bem em ambos (JSON estrito com validação). Prompt caching da Anthropic só beneficia o provedor padrão.

## ADR-009 — Sem webhooks enquanto o ambiente for 100% local

**Contexto**: a arquitetura previa webhook `push` do GitHub para sync incremental, mas GitHub não alcança `localhost` — exigiria túnel (smee/ngrok), que é infraestrutura frágil e contradiz a regra "100% local até o fim do MVP".
**Decisão**: nenhum webhook no MVP. Reconciliação: (a) re-sync automático após cada commit feito pelo próprio ProPlan (bootstrap, Kanban); (b) botão Sincronizar para mudanças externas; (c) opcional futuro: polling agendado por projeto. Webhook volta quando existir endpoint público (deploy em nuvem), reaproveitando o desenho da ARCHITECTURE.md.
**Consequências**: mudanças feitas fora do ProPlan só aparecem em sync manual — aceitável para usuário único que sabe quando mexeu no repo. O código de sync não muda; só o gatilho.
