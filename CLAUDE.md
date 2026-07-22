# CLAUDE.md — RRB ProPlan

## Diretrizes de implementação (Code)

Priorizam cautela sobre velocidade; em tarefa trivial, bom senso.

- **Pense antes de codificar.** Não presuma: declare suposições, exponha
  interpretações alternativas, aponte a abordagem mais simples. Em dúvida, pare
  e pergunte ao PI (já é regra: sem spec → perguntar).
- **Simplicidade primeiro.** Código mínimo que resolve. Sem abstração de uso
  único, sem flexibilidade não pedida, sem tratar cenário impossível.
- **Alterações cirúrgicas.** Cada linha alterada rastreável ao pedido. Não
  refatore o que não quebrou; mantenha o estilo existente; código morto não
  relacionado se aponta, não se apaga. **Exceção:** atualizar `docs/` é escopo
  obrigatório da entrega, não "melhoria adjacente".
- **Execução verificável.** Traduza tarefa em critério checável ("adicionar
  validação" → "teste para entrada inválida passa"). `dev`, `test`, `lint`
  verdes é o piso.

## Papéis e governança

- **Rodrigo Reis (PI)** — decide escopo, prioridades e trade-offs; aprova specs e aceita entregas.
- **Claude Cowork (planejamento)** — especifica e mantém `docs/` e as specs em `docs/specs/`. Antes de finalizar qualquer spec, apresenta as perguntas abertas e dúvidas ao PI — spec só vira `aprovada-pi` com todas resolvidas (evitar retrabalho). Quando a spec vira `aprovada-pi`, **cria a issue-fatia no board** (coluna Backlog, assignee PI). **Nunca implementa código** — implementação é exclusiva do Claude Code.
- **Claude Code (você)** — planeja, codifica, testa (código, UX e UI — pode usar as skills do impeccable), atualiza a documentação e **sempre commita todos os documentos de `docs/`** junto da entrega. Implementa a partir deste arquivo + `docs/` + spec da feature em `docs/specs/`. **Não cria a issue** (é do Cowork) — pega o card, move pelo fluxo e entrega com PR. Pode criticar arquitetura, **não escopo**. Sem spec para a tarefa, ou spec ambígua → perguntar ao PI antes de codificar, nunca assumir. Deve apontar problemas técnicos da spec — a correção passa pelo PI.

### Ciclo de vida de uma fatia (processo do trio — **não é feature do produto**)

Isto é convenção **nossa**, executada à mão via GitHub MCP: o **Cowork cria** a issue, o **Code move e entrega**. **Nada disso vira código do ProPlan** — o ADR-014 é explícito: o ProPlan se adapta ao repo, nunca impõe convenção. Se um segundo repo adotar `docs/specs/`, reavaliar.

1. **Spec vira `aprovada-pi`** → o **Cowork** cria a issue no board: coluna **Backlog** (`proplan:backlog`), título no **Padrão de título de issue** (ver abaixo), corpo com link para o arquivo da spec, assignee = **PI**.
2. **Code começa** → move da Backlog para **A Fazer** (`proplan:todo`) ao pegar e para **Em Andamento** (`proplan:doing`) ao iniciar; se atribui.
3. **Code entrega** → abre PR com **`refs #N`** no corpo. **NUNCA `closes #N`** — fecharia a issue no merge e **forjaria o aceite do PI** (ADR-011). Só **depois do merge**, o Code aplica `proplan:done` → card vai para **Feito**, com o **link do PR** no corpo da issue. Declarar "terminei" **sem PR mergeado** é o "fechamento frágil" que este produto existe para detectar — não o produza aqui dentro.
4. **PI aceita** → **só o PI** fecha a issue e aplica `proplan:finalizado`. **A issue só fecha quando o trabalho realmente acabou.** Nenhuma automação pode forjar aceite (ADR-011). O Code **nunca** fecha issue nem move card para Finalizado.

**`card = fatia`** — uma issue por fatia, **nunca por passo da spec**. Os passos vivem no `docs/DEVELOPMENT.md` (ADR-011).

### Padrão de título de issue (acordo PI, 2026-07-20)

Todo título de card **começa** com tokens em colchetes, **nesta ordem**, seguidos de um espaço e o título livre. Motivo: olhando o board, dá pra ler **qual MVP** e **qual SPEC** — não só a fatia. Reforça a regra do `STATUS.md`: *nunca o número nu, sempre o par*.

**Forma:** `[MVP<n>][SPEC-<nnn>][<fatia|tipo>] <título livre>`

- **`[MVP<n>]`** — `[MVP1]`/`[MVP2]`/`[MVP3]`, quando a fatia pertence a um MVP conhecido.
- **`[SPEC-<nnn>]`** — 3 dígitos (`[SPEC-024]`), quando há spec. **Permanece** em correção que conserta comportamento definido numa spec.
- **`[F<n>]`** — a fatia (`[F18]`). Para card que **não é fatia**, entra no lugar um **token de tipo**: `[FIX]` (correção de bug) ou `[INFRA]` (processo/infra).

**Regra de ouro:** só entra token que é **verdade** — nunca inventar SPEC ou fatia. Card carrega os tokens que existem, na ordem; os que não existem, omite.

Exemplos:

- Fatia com spec → `[MVP2][SPEC-024][F18] Épicos: hierarquia MVP→fatia no board`
- Correção ligada a uma spec → `[MVP2][SPEC-022][FIX] reinstall re-liga o Tenant`
- Correção ligada só a ADR/doc (sem spec) → `[MVP1][FIX] Kanban atualiza sem F5`
- Processo/infra sem MVP/SPEC → `[INFRA] CI: relatório de testes por SPEC/issue`

O par MVP↔SPEC↔Fatia deriva do **Índice Fatia ↔ SPEC** do `docs/STATUS.md` (fonte única). Card de teste/descartável leva `[TEST]` no lugar do tipo.

### Fatia exige spec. Correção de bug documentado, não.

A regra *"sem spec `aprovada-pi` → não codificar"* existe para impedir **escopo assumido** — o Code inventando o que fazer. Ela **não se aplica** quando não há escopo a assumir:

| tipo | precisa de spec? | por quê |
|---|---|---|
| **Fatia** (escopo novo, comportamento novo) | **Sim** | há decisões de produto a tomar — são do PI |
| **Correção de bug já documentado** (o comportamento correto está escrito num ADR, no `ARCHITECTURE.md` ou numa spec existente) | **Não** | não há o que decidir: o certo já está definido. Basta o item no `STATUS.md` + a regra escrita |
| **Bug sem comportamento correto definido** | **Sim** — ou pelo menos perguntar ao PI | se o certo ainda não foi decidido, decidir é do PI |

Exemplo vivo: **sync SHA-aware** (elimina o `noop` falso) — não tem spec e **não precisa**. A regra está no `ARCHITECTURE.md` → Resiliência, com os call sites e o que é proibido. Implementar direto.

## Regras de trabalho

- **Idioma**: documentação, specs, commits e comunicação sempre em português (pt-BR); código e identificadores em inglês.
- **Sem hardcode e sem mock** — dado local de desenvolvimento entra via seed (`prisma/seed.ts`), criado na primeira fatia que precisar.
- **Desenvolvimento é local** (docker-compose) — **e existe produção** desde a
  SPEC-027 (ADR-022, 2026-07-21): Railway (web + api + Postgres + Redis) com
  Hostinger só no DNS. Runbook operacional em `docs/DEPLOY.md`.
- **Portas**: web `5180` (strictPort — se ocupada, falha em vez de trocar), API `3311` (era 3000; remapeada por colisão com outros stacks locais — configurável via `API_PORT`). Postgres host `5433`, Redis host `6380` (host bindings remapeados; rede interna do compose segue 5432/6379).

## O que é

Painel de gestão visual de projetos de software. Ingere documentação (nunca código) de repos GitHub e renderiza workspace com abas: Visão Geral, Kanban, Grafo, Arquitetura, Skills & Agentes, Testes, Design, Deploy. Usuário único no MVP; multi-tenant no futuro.

## Regras de arquitetura (não violar)

- **Monolito modular NestJS.** Módulos: `catalog`, `ingestion`, `insight`, `board`, `identity` (futuro). Módulos se comunicam por interfaces públicas (services exportados) — nunca importar entidades internas de outro módulo. Ver `docs/ARCHITECTURE.md`.
- **Nunca clonar repositórios.** Toda leitura via GitHub Contents/Git Trees API, restrita a `docs/`, `README.md`, `CLAUDE.md`, `.claude/`, `.github/workflows/`.
- **Inferência de IA sempre versionada.** Persistir com `docs_tree_sha` de entrada. Nunca chamar a Anthropic API no caminho de renderização de uma request.
- **Repositório é fonte de verdade** para toda a documentação. Banco = índice/cache. Conflito de escrita em doc: comparar SHA base; divergiu → re-sync e reaplicar.
- **Estado do trabalho vive nas GitHub Issues** (ADR-011). **6 colunas**: `open`+`proplan:backlog|todo|doing` · **Feito** = **`open`**+`proplan:done` (*entregue, aguardando aceite*) · **Finalizado** = `closed`+`proplan:finalizado` (*aceito pelo dono*) · **Descartado** = `closed`+`proplan:descartado`. **A issue só fecha quando o trabalho realmente acabou** — fechar é ato deliberado do dono, nunca efeito colateral de merge. Issue nunca é deletada. **`closes #N` é proibido** (forjaria aceite); usar `refs #N`. Mover para Finalizado/Descartado posta comentário de carimbo na issue. Repo sem Issues → board somente leitura (modo degradado, sinalizado na UI).
  - **`card = fatia`**: uma issue por fatia, nunca por sub-item. As Issues respondem *"qual fatia está em qual coluna"*; o `docs/DEVELOPMENT.md` responde *"onde estou dentro da fatia"* (os N passos, com checkmarks). Granularidades diferentes ⇒ nenhum fato mora nos dois lugares.
- **`docs/` = conteúdo humano · `.proplan/` = coisas do ProPlan** (artefato gerado + configuração). A projeção do board é `.proplan/STATUS.md` (raiz), **nunca editada à mão**; o mapeamento de documentos é `.proplan/config.yml`. Nada do ProPlan entra em `docs/` — isso mascararia o alerta de doc defasada do ADR-010 (que mede o último commit em `path=docs`, subdiretórios incluídos).
- **O ProPlan se adapta ao repo, nunca o contrário** (ADR-014). Documento é resolvido por escada: convenção → alias conhecido → `.proplan/config.yml` → **ausente** (que é informação, não falha). **Nunca renomear, mover ou reescrever documento do repo-alvo** — em nenhuma fatia. Bootstrap é sempre proposta revisada pelo dono.
- **Jobs assíncronos via BullMQ** (Redis). Não introduzir Kafka sem revisar ADR-004.

- **Auth = GitHub App** (ADR-015, Fatia 4.5). Dois tokens: **user-to-server** para **toda leitura** (respeita a visibilidade do usuário) e **installation token** para **toda escrita** (identidade `proplan[bot]`). Ler com installation token é proibido. Catálogo lista só repos onde o App está instalado.

## Stack

NestJS + TypeScript · React + Vite (react-flow, dnd-kit) · PostgreSQL (Railway em produção; docker-compose no dev) · Prisma · Redis/BullMQ · GitHub API via fetch (Octokit v4+ é ESM-only e conflita com o build CJS do Nest — não reintroduzir sem resolver isso) · Anthropic API.

## Convenções de código

- Estrutura por módulo: `presentation/` (controllers), `application/` (use cases), `domain/` (entidades, regras), `infrastructure/` (repositórios, clients).
- Testes junto ao módulo (`*.spec.ts`); e2e em `test/`.
- Commits em português, imperativo, prefixo do módulo: `catalog: adiciona listagem de repos`.

## Grafo de conhecimento (graphify)

O repo tem um grafo de conhecimento persistente em `graphify-out/` (gerado pela skill `/graphify` — https://github.com/Graphify-Labs/graphify). Ele indexa código + docs (1.9k nós, 192 comunidades) e responde perguntas sobre o codebase gastando muito menos tokens que ler arquivos.

- **Antes de explorar o codebase** para entender arquitetura, fluxos ou "quem chama o quê": consulte o grafo primeiro — `/graphify query "<pergunta>"` (ou `graphify query` via CLI). Só leia arquivos direto quando precisar do conteúdo exato.
- **Ao final de cada entrega** (junto com STATUS.md/DEVELOPMENT.md): rode `/graphify . --update` — incremental, re-extrai só arquivos novos/alterados via manifest. Não recrie o grafo do zero.
- `graphify-out/` é artefato local (cache), não entra em commit.

## Documentos-chave

- `docs/DEVELOPMENT.md` — **sua ordem de execução e status por item (você é o dono; atualize a cada entrega junto com STATUS.md)**
- `docs/ARCHITECTURE.md` — desenho, módulos, dados, resiliência
- `docs/DECISIONS.md` — ADRs (ler antes de propor mudança estrutural)
- `docs/CONVENTION.md` — contrato de dados dos projetos-alvo (o coração do produto)
- `docs/DESIGN.md` — design system Carbono/Claro: shell workspace, tokens, componentes e regras de comportamento (protótipos em `docs/design/`)
- `docs/STATUS.md` — Kanban/roadmap deste projeto (mantenha atualizado ao concluir fatias)
- `docs/LANDSCAPE.md` — **cenário competitivo datado**: o que o mercado já faz, o que morreu por causa disso, e os gatilhos que obrigam a revisar. Ler antes de propor feature de MVP2 — evita reconstruir o que já existe de graça (ADR-017)
- `docs/TESTING.md` — Teste de QA, Resultado dos teste das SPEC.
