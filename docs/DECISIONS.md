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

**Adendo (2026-07-12) — metadados de commit e manifests de dependência**: a regra proíbe ler **conteúdo de código**, não proíbe ler **metadados sobre o código**. Ficam explicitamente autorizados:

1. **Commits API** — data, SHA, autor e mensagem de commit, com filtro por `path`. Nunca `diff`, nunca `patch`, nunca conteúdo de arquivo fora do escopo do ADR-003. Habilita o ADR-010.
2. **Dependency Graph / SBOM API** (`GET /repos/{owner}/{repo}/dependency-graph/sbom`) — lista de dependências em SPDX JSON, derivada dos manifests pelo próprio GitHub. Autorizado, **não implementado no MVP**. Ressalva registrada: em repositório **privado** o Dependency Graph vem **desabilitado por padrão** — qualquer feature construída sobre ele precisa de fallback explícito ("não habilitado neste repo"), nunca falhar em silêncio. Uso previsto: aba Arquitetura ("stack detectada") e Deploy. Requer spec própria antes de codificar.

**Adendo (2026-07-13) — documentos binários no escopo (preview sob demanda)**: um `.pdf`, `.docx`, `.png` ou `.html` **dentro de `docs/`** é documentação legítima, não código — o path já é autorizado. O que barrava era técnico (o pipeline lia todo blob como texto UTF-8, corrompendo binário). Fica autorizado:

3. **Metadado de qualquer arquivo do escopo**: o índice `documents` lista todo arquivo de `docs/**` (e demais paths do escopo), com `kind` classificado por extensão. Só **markdown/texto** tem o conteúdo baixado e persistido (alimenta abas, grafo, resolução). Binário grava **só metadado** (path, sha, `kind`) — **nunca os bytes**.
4. **Stream sob demanda de documentos binários** (`pdf`, `image`, `html`, `docx`): quando o usuário abre o preview, a API busca o blob do GitHub **na hora** (user token, respeitando visibilidade) e faz stream **efêmero** — nunca persiste. `docx` é transformado em texto (mammoth); `html` renderiza em `<iframe sandbox="">` sem scripts + CSP restritiva no response. O endpoint só serve paths que já estão no índice do projeto (não é proxy arbitrário). **Nunca** serve arquivo de código-fonte (fora do escopo do ADR-003).

O que continua proibido: clonar o repo, baixar blobs **de código-fonte** (fora do escopo), **persistir bytes de binário no banco**, Code Search API, varredura de `TODO`, leitura de diffs.

## ADR-004 — BullMQ em vez de Kafka

**Contexto**: jobs assíncronos (sync, inferência) precisam de fila com retry. Kafka traria custo operacional (broker, particionamento, ops) sem consumidor além do próprio monolito.
**Decisão**: BullMQ sobre Redis (já presente para cache). Eventos de domínio in-process via `@nestjs/event-emitter`.
**Consequências**: infra mínima (Postgres + Redis). Se multi-tenant exigir streaming/fan-out real, este ADR deve ser revisado — o desacoplamento por eventos internos facilita a migração.

## ADR-005 — `STATUS.md` no repo-alvo como fonte de verdade do Kanban

> ⚠️ **Superseded pelo ADR-011 (2026-07-12).** O PI antecipou a virada para a Fatia 5 — Issues são a fonte de estado; `STATUS.md` é projeção gerada. Este ADR só sobrevive como **modo degradado** (repo com Issues desabilitada → board somente leitura sobre `STATUS.md`). Não escrever write-path em markdown.

**Contexto**: o Kanban precisa de fonte de verdade. Banco próprio criaria estado duplicado e divergente do repo; GitHub Issues/Projects acopla o produto a como cada projeto usa issues.
**Decisão**: `docs/STATUS.md` (formato em `CONVENTION.md`) é a verdade. Mover card = editar o MD + commit via Contents API com SHA base; webhook confirma e o índice local reconcilia. IA faz bootstrap do arquivo em projetos legados; o dono revisa e commita.
**Consequências**: o Kanban funciona em qualquer clone/editor (é só markdown), sobrevive ao próprio ProPlan e fica auditável no histórico git. Custo: latência de escrita (commit + webhook, UI otimista com `202`) e resolução de conflito por SHA (um retry automático; persiste → intervenção manual).

## ADR-006 — Stack: NestJS + React + PostgreSQL/Supabase + Redis

**Contexto**: stack dominada pelo dono; ecossistema Node com melhor suporte a Octokit/Anthropic; React tem as melhores libs para os dois componentes críticos (react-flow para grafo, dnd-kit para Kanban).
**Decisão**: NestJS (TypeScript) no back, React + Vite no front, PostgreSQL no Supabase, Redis para filas/cache. Auth do MVP: PAT do GitHub em variável de ambiente (usuário único). OAuth GitHub só com multi-tenant (módulo `identity`).
**Consequências**: uma linguagem no stack inteiro; Supabase dá Postgres gerenciado grátis no MVP e caminho de auth pronto para o futuro SaaS.
**Adendo (2026-07-12)**: a parte "PAT em variável de ambiente" foi substituída pelo ADR-007.

## ADR-007 — Login GitHub OAuth antecipado; PAT eliminado; Prisma como ORM

> ⚠️ **Parte de autenticação superseded pelo ADR-015 (2026-07-12)**: OAuth **App** → **GitHub App** (dois tokens; escritas com identidade `proplan[bot]`). O login continua sendo um fluxo OAuth — agora o do App. **Prisma como ORM continua valendo.** Migração na Fatia 4.5 (SPEC-008), antes da Fatia 5.

**Contexto**: o dono decidiu ter login desde a Fatia 1. Manter PAT + OAuth seria redundante: o token OAuth do usuário já lê os repos que o login autoriza.
**Decisão**: GitHub OAuth App (authorization code flow) desde a Fatia 1. Sessão = JWT em cookie httpOnly/SameSite=Lax. Token GitHub do usuário criptografado (AES-256-GCM, chave em env) na tabela `users`. Uma parte mínima do módulo `identity` nasce agora (login/logout/me); RBAC e multi-tenant continuam na Fatia 8. ORM: Prisma.
**Consequências**: sem PAT pra gerenciar; escopo `repo read` concedido no consentimento. Custo: criar OAuth App no GitHub e gerenciar 3 secrets (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` + `JWT_SECRET`). Rodando local, o callback aponta pra `http://localhost:3000/auth/github/callback` e o front roda em `http://localhost:5180`.

## ADR-008 — Provedor de IA configurável, Anthropic como padrão

**Contexto**: o PI mantém chaves de Anthropic, OpenAI e OpenRouter e quer escolher o provedor sem mexer em código (decisão de 2026-07-12, SPEC-003).
**Decisão**: interface `LlmClient` no módulo `insight` com dois adapters HTTP — Anthropic e OpenAI-compatível (cobre OpenAI e OpenRouter, mesmo formato de API). Provedor padrão escolhido na tela de Configurações (tabela `settings`); Anthropic é o default. Modelo por provedor vem de env, não da UI. Provedor sem chave no env fica desabilitado no menu.
**Consequências**: troca de provedor sem redeploy; custo de manter dois formatos de client e prompts que funcionem bem em ambos (JSON estrito com validação). Prompt caching da Anthropic só beneficia o provedor padrão.

## ADR-010 — Alerta de documentação defasada por metadados de commit

**Contexto**: a dor central do produto é retomar projeto esquecido. O maior risco nesse cenário não é *não ter* documentação — é a documentação **mentir**: o código evoluiu, o `README` não. Todo o valor do painel (Visão Geral, Arquitetura, Design) desaba silenciosamente se o doc lido tem dois anos e o código tem três meses. Hoje não existe nenhum sinal disso.

**Decisão**: calcular defasagem por **metadados de commit** (autorizados no adendo ao ADR-003), no fim de cada `sync-job`, com **duas** chamadas à Commits API:

- `GET /repos/{o}/{r}/commits?path=docs&per_page=1` → `lastDocsCommitAt`
- `GET /repos/{o}/{r}/commits?per_page=1` → `lastCodeCommitAt` (último commit do repo, qualquer path)

Persistidos como colunas em `Project` — não em tabela nova, não em cache. Isso mantém o cálculo fora do caminho de renderização (ADR-002) e permite ordenar o catálogo por defasagem no futuro.

**Regra do alerta**: dispara ⚠️ quando `lastCodeCommitAt > lastDocsCommitAt` **e** a diferença excede um limiar. O limiar é **configurável na tela de Configurações** (mesma tabela `settings` da SPEC-003), **padrão 90 dias**. `0` desliga o alerta e a UI passa a só exibir as duas datas.

**Alternativas rejeitadas**:
- *Por documento* (1 request por doc): daria badge por aba, mas custa N requests por sync (repo com 16 docs = 16 chamadas) para um ganho marginal sobre o sinal global. Reavaliar se o alerta global se provar útil.
- *Cache Redis sob demanda*: reintroduz chamada externa no caminho de render — contradiz o ADR-002.
- *Autoria do último commit* ("quem detém o contexto"): irrelevante com usuário único. O sinal é a **data**, não a pessoa.

**Consequências**: determinístico, sem IA, custo fixo de 2 requests por sync. O sinal é grosseiro por construção — `lastCodeCommitAt` é o último commit *de qualquer coisa*, incluindo o próprio commit de docs que o ProPlan acabou de fazer (write-back de bootstrap/Kanban), o que pode zerar a defasagem artificialmente. Mitigação aceita: commits do próprio ProPlan tocam apenas `docs/`, então mexem em `lastDocsCommitAt` e `lastCodeCommitAt` juntos — o alerta some, mas por um motivo verdadeiro (o doc *acabou* de ser atualizado). Falso negativo possível: commit de código sem nenhum commit de doc há muito tempo é o caso que o alerta pega bem; o inverso (doc atualizado, código mentiroso) ele não pega — nem deveria.

## ADR-011 — Issues como fonte de estado; `STATUS.md` como projeção gerada (a partir do MVP2)

**Status**: aprovado pelo PI em 2026-07-12. **Supersede o ADR-005 a partir do MVP2** — ver "Pergunta aberta" abaixo, que ainda decide o momento exato da virada.

**Contexto**: o ADR-005 elegeu `docs/STATUS.md` como fonte de verdade do Kanban. A escolha é sólida enquanto houver **um escritor** (o dono, via ProPlan). O MVP2 quebra essa premissa: agentes passam a consultar e a atualizar estado via MCP, e mais de um agente pode trabalhar em paralelo em cards distintos do mesmo repo. Markdown não tem ID estável por item, não tem update atômico e não tem máquina de estado — escrita concorrente vira conflito de merge, resolvido na mão, para sempre. O que o ADR-005 acertou e deve ser preservado: estado dentro do git dá **snapshot versionado junto dos docs** e sobrevive ao próprio ProPlan.

**Decisão**: separar *onde o estado vive* de *onde o estado é lido*.

- **GitHub Issues = fonte de verdade do trabalho.** ID estável, máquina de estado, atribuição, labels, vínculo nativo com PR (`closes #12`), concorrência resolvida pela API. Toda mutação de card do ProPlan vira chamada à Issues API.
- **`.proplan/STATUS.md` = artefato de build**, gerado pelo ProPlan a cada sync e commitado na **raiz** do repo-alvo (fora de `docs/` — ver a regra abaixo), com cabeçalho `<!-- gerado pelo ProPlan — não edite à mão -->`. Preserva legibilidade humana, histórico versionado do estado e independência do ProPlan.
- **Escritor único do `STATUS.md` é o ProPlan.** Ninguém edita à mão. Edição manual é sobrescrita no próximo sync — e o ProPlan avisa antes.

**Modo degradado**: repo com Issues desabilitada cai no comportamento do ADR-005 (`STATUS.md` como fonte, escritor único, sem escrita concorrente por agentes). O ProPlan **sinaliza o modo degradado na UI** — nunca opera degradado em silêncio.

**Alternativas rejeitadas**:
- *Manter `STATUS.md` como fonte também no MVP2*: só funciona com um escritor; corrompe estado em silêncio no primeiro agente paralelo. Custo de reversão altíssimo (dado perdido, não código).
- *Estado só em banco do ProPlan*: viola "repositório é fonte de verdade"; o projeto deixa de ser retomável sem o ProPlan.
- *Issues + `STATUS.md` ambos escrevíveis*: dois donos do mesmo estado. Pior de todos — a divergência é silenciosa.

**Consequências**: exige escopo de escrita em Issues no OAuth (hoje o ADR-007 concede `repo read`) — o usuário precisa reconsentir. O Kanban do ProPlan passa a depender de a Issues API estar disponível (antes dependia só de Contents). Ganha-se concorrência segura, vínculo automático card↔PR e a base para o MCP responder "qual issue pegar" com identidade estável.

**Momento da virada — decidido pelo PI em 2026-07-12: antecipado para a Fatia 5.** A SPEC-005 foi reescrita sobre este ADR (Issues como fonte) antes de qualquer linha de código. Custo aceito: reconsentimento de OAuth com escopo de escrita agora, e migração do bootstrap da Fatia 3 (que gerava `STATUS.md` por IA e passa a **criar issues**). Ganho: nenhum write-path descartável é escrito, e o requisito mais caro da spec anterior — round-trip fiel byte a byte do markdown — **deixa de existir**, porque a projeção é gerada do zero a cada vez.

**Onde a coluna mora** (**corrigido em 2026-07-13** — ver "Erro corrigido" abaixo):

| coluna | estado da issue |
|---|---|
| Backlog | `open` + `proplan:backlog` (ou `open` sem label `proplan:*`) |
| A Fazer | `open` + `proplan:todo` |
| Em Andamento | `open` + `proplan:doing` |
| **Feito** | **`open`** + `proplan:done` — *entregue, aguardando aceite* |
| **Finalizado** | `closed` + `proplan:finalizado` — *aceito pelo dono* |
| Descartado | `closed` + `proplan:descartado` — *decisão de não fazer* |

**A issue só fecha quando o trabalho realmente acabou.** Fechar é **ato deliberado do dono**, nunca efeito colateral de merge.

**Por que "Feito" e "Finalizado" são colunas, e não um badge**: "Feito" **é uma fila com dono** — trabalho parado aguardando aceite. Coluna existe para isso. Um board que mostra "3 fatias esperando aceite" é útil; um badge escondido dentro de Feito, não.

### Erro corrigido em 2026-07-13 — `Feito` era `closed`, e estava errado

A versão anterior deste ADR mapeava **`Feito = closed` sem label**. O motivo era automação barata: `closes #42` no corpo do PR fecha a issue nativamente no merge ⇒ o card cairia em Feito sozinho, com estado derivado de evidência e **zero código**. **Otimizei por automação e paguei com verdade.**

**O defeito**: uma fatia **entregue e não aceita** apareceria **fechada no GitHub**. E o ProPlan **não é o único leitor** — o **ADR-017** registra que o GitHub MCP serve issues a agentes. Um agente perguntando *"o que está aberto neste repo?"* **não veria** o item pendente de aceite e concluiria que está tudo resolvido. Trabalho que ninguém revisou, marcado como concluído para todo mundo que não usa o ProPlan.

Isso é, literalmente, o **"fechamento frágil"** que o MVP2 se propõe a detectar. O produto estava **fabricando o defeito que existe para caçar**.

**Consequência**: `closes #N` no PR passa a ser **proibido no nosso processo** (usar `refs #N` — ver `CLAUDE.md`); senão o merge fecharia a issue e **forjaria o aceite**, exatamente o que este ADR proíbe.

**O que se perde, e como recuperar**: some a propriedade "estado derivado de evidência, não de auto-relato" — quem marca Feito volta a ser o executor. Recuperação, melhor que o original: **o ProPlan lê os PRs vinculados à issue** — issue com PR mergeado ⇒ Feito, derivado de evidência **sem** fechar a issue. E de brinde nasce o sinal do MVP2 no MVP1: **"card em Feito sem PR mergeado" = fechamento frágil**. Enquanto a leitura de PRs não existir, o executor aplica `proplan:done` **só depois do merge**, com o link do PR no card — auto-relato **com prova anexada e verificável**.

**Carimbo**: ao mover para **Finalizado** ou **Descartado**, o ProPlan **posta um comentário na issue** (`proplan: finalizado pelo PI em <data>` / `proplan: descartado em <data>`). Fica no GitHub, permanente, auditável, sobrevive ao ProPlan — **evidência real**, não cache nosso. `closed_at` passa a marcar o **aceite** (não a entrega), o que agora é honesto.

GitHub Projects v2 (campo Status nativo, ordenação manual) foi **rejeitado no MVP** — exige GraphQL e um Project configurado por repo; reavaliar no MVP2 junto com sub-issues.

**Granularidade do card — `card = fatia`** (decisão do PI, 2026-07-13). Vale para o `rrb-proplan` gerenciando a si mesmo, e é a regra padrão.

O `DEVELOPMENT.md` **também rastreia estado** (cada sub-item tem `a-fazer`/`feito`). Se o card tivesse a granularidade do sub-item, existiria um card "Mermaid no viewer" **e** um item "Mermaid no viewer" no `DEVELOPMENT.md` — **o mesmo fato em dois lugares**, que é exatamente o pecado que este ADR existe para matar. O problema nunca foi a existência das duas camadas; foi elas caírem na **mesma granularidade**.

| camada | responde | dono |
|---|---|---|
| **Issues** (uma por fatia) | *qual fatia está em qual coluna* | ProPlan / PI |
| **`docs/DEVELOPMENT.md`** (os N passos, com checkmarks) | *onde estou dentro da fatia* | Claude Code |

Granularidades diferentes ⇒ **sobreposição zero**. Nenhum fato mora nos dois.

**Sub-issues do GitHub foram rejeitadas** (por ora): dariam hierarquia nativa e barra de progresso `3/7` — mas o board é uma grade **plana** de 5 colunas, e sub-issue obriga a escolher entre mostrar a mãe (perde granularidade), as filhas (perde a fatia) ou as duas (duplica o trabalho na tela). Nenhuma serve. E o único ganho real (`3/7`) o `DEVELOPMENT.md` já dá — com o *porquê* de cada passo. **A escolha é reversível na direção certa**: as issues-mãe já existem; pendurar filhas depois é trivial. O inverso (nascer com sub-issues e achatar) exigiria fechar e recriar issue — perdendo o histórico que este ADR protege. Reavaliar no MVP2 **só se** o board plano se provar grosso demais na prática.

**Onde a projeção mora — `docs/` × `.proplan/`** (decisão do PI, 2026-07-12): a projeção é gravada em **`.proplan/STATUS.md`**, na **raiz** do repo-alvo, fora de `docs/`. Regra geral, válida para todo artefato futuro: **`docs/` = conteúdo humano; `.proplan/` = gerado pelo ProPlan.** Motivo: o ADR-010 usa o último commit em `path=docs` como sinal de "quando um humano mexeu na doc" — se o board commitasse em `docs/` a cada card arrastado, o alerta de documentação defasada morreria em silêncio, e quanto mais o produto fosse usado, mais cego ficaria. Registro dos descartes: (a) `docs/.proplan/` **não funciona** — `path=docs` na Commits API inclui subdiretórios; (b) filtrar commits por mensagem `proplan:` funciona mas pagina, é heurística de string e filtraria por engano os commits de `docs/CONTEXT.md` (ADR-013), que são conteúdo humano e devem contar como frescor.

## ADR-012 — Confiança é calculada, nunca inferida; LLM é extrator, não juiz

**Status**: aprovado pelo PI em 2026-07-12.

**Contexto**: o MVP2 promete "memória operacional verificável": toda resposta do ProPlan (e do seu MCP) carrega evidência e um grau de confiança. A tentação óbvia é pedir o score ao LLM. Isso destrói o produto pelo motivo que ele existe: um score não-reprodutível é opinião com selo de autoridade — exatamente o que o produto se propõe a substituir.

**Decisão**: o **número é sempre determinístico**, função apenas de metadado. Mesmo repo + mesmo `docs_tree_sha` → mesmo score, sempre.

Sinais que compõem o score (todos calculáveis, sem IA):

| sinal | cálculo | fonte |
|---|---|---|
| `staleness` | `last_commit(repo) − last_commit(arquivo)` em dias | Commits API (ADR-003, adendo; reusa ADR-010) |
| `cobertura` | entidades do modelo canônico presentes / total | parse dos docs |
| `contradição` | nº de pares de spans conflitantes confirmados | ver abaixo |
| `drift` | doc afirma artefato (workflow, módulo, ambiente) que o sinal do GitHub não confirma | workflows, releases, checks |

**Papel do LLM**: *extrator com procedência obrigatória*. Ele nunca emite "a doc está inconsistente". Ele emite **dois spans concretos** — `ARCHITECTURE.md:31` afirma A, `ADR-004:12` afirma B — e a regra determinística decide se isso conta como contradição e quanto pesa. Sem par de spans citáveis, a saída do LLM é descartada.

**Consequências**: o score é testável por fixture (regressão real, não "avaliação"), auditável (o usuário vê a conta), e recalculável a custo zero de API. Custo: o score é grosseiro por construção — ele mede *procedência e frescor*, não *verdade*. Um doc recém-commitado e completamente mentiroso pontua alto. Limite aceito conscientemente; é o `drift` que ataca esse caso, não o score.

## ADR-013 — Asserção humana como quarta classe de proveniência

**Status**: aprovado pelo PI em 2026-07-12.

**Contexto**: a pergunta de maior valor que um agente faz é "**o que eu não devo mexer?**" — e a resposta não está em repo nenhum. Não está no doc, não está no commit, não está no CI. Está na cabeça de quem escreveu. Mesma natureza: "esse módulo parece morto e não é", "essa gambiarra é intencional", "não refatore isso antes de X". Um ProPlan que só lê o repo **nunca** saberá disso — e são exatamente as respostas que evitam o agente quebrar coisa.

**Decisão**: o modelo canônico ganha uma quarta classe de proveniência, ao lado de `fato` (extraído do repo, com link), `inferência` (IA, com spans) e `hipótese` (não confirmado):

- **`asserção`** — afirmado pelo humano. Carrega: autor, data, `sha` do repo no momento da afirmação, e **arquivos/paths citados**.
- **Validade**: se algum path citado recebeu commit depois da data da asserção, ela é marcada **"a revalidar"** — não é apagada, é rebaixada. O ProPlan pergunta, o humano confirma ou corrige.
- **Persistência**: capturada na UI do ProPlan e **escrita de volta no repo-alvo** em **`docs/CONTEXT.md`** (convenção v2). Não fica só no banco — isso preservaria o ADR "repositório é fonte de verdade" apenas na aparência, e o conhecimento morreria junto com o ProPlan.
- **Fica em `docs/`, não em `.proplan/`** — e a distinção importa: asserção é **conteúdo humano** (o ProPlan só é o teclado), então seus commits **devem** contar como frescor de documentação no ADR-010. Só o que o ProPlan *deriva* sozinho vai para `.proplan/`. Ver a regra `docs/` × `.proplan/` no ADR-011.

**Consequências**: é o único ativo do produto que **cresce com o uso** em vez de depreciar — índice de docs qualquer um copia; base de conhecimento tácito versionado e com validade, não. Custo: exige interação humana (o ProPlan tem que *perguntar*, e perguntar bem — pergunta demais vira ruído e o usuário para de responder). Risco real: asserção velha e nunca revalidada é pior que asserção ausente, porque tem cara de fato. Mitigação: a marca "a revalidar" é obrigatória na resposta do MCP, nunca omitida.

## ADR-014 — Escada de resolução de documentos; o ProPlan mapeia, nunca renomeia

**Status**: aprovado pelo PI em 2026-07-12.

**Contexto**: a `CONVENTION.md` casa documento por **caminho exato** (`docs/ARCHITECTURE.md`, `docs/DEPLOY.md`) + frontmatter `proplan: v1`; qualquer outro arquivo é "documento livre" e não alimenta aba nenhuma. Isso funciona neste repo — e **falha em todos os outros**. Os repos reais do PI foram documentados ao longo do tempo, com nomes vindos de fontes diferentes (Claude, artigos, modelos de terceiros): `arquitetura.md`, `adr/0001-*.md`, `ROADMAP.md`, `TODO.md`, `AGENTS.md`, `docs/qa/`. Apontar o ProPlan para um deles hoje resulta em **todas as abas vazias** — e o produto passaria a exigir que o usuário reformatasse o repo *antes* de o ProPlan servir para alguma coisa, que é o oposto exato da promessa de "retomar projeto esquecido".

**Decisão**: cada entidade do modelo canônico é resolvida por uma **escada**, parando no primeiro nível que resolve:

| nível | como | proveniência |
|---|---|---|
| **1. Convenção** | caminho exato + `proplan: v1` | `fato`, confiança cheia |
| **2. Alias conhecido** | tabela determinística de nomes e diretórios (case- e acento-insensitive): `architecture\|arquitetura\|arch`, `adr/\|decisions/\|decisoes/`, `roadmap\|todo\|backlog`, `testing\|qa\|testes`, `deploy\|deployment\|infra`, `AGENTS.md`, `CONTRIBUTING.md`… | `fato`, confiança levemente menor (caminho não-canônico) |
| **3. Classificação semântica** | nenhum nome bate, mas o conteúdo claramente é aquela entidade | `inferência` — badge âmbar, exige spans citados (ADR-012). **Fatia 7**, não antes |
| **4. Ausente** | nada resolve | aba mostra **"não documentado"** + CTA de bootstrap. **Nunca inventa** |

**O nível 4 não é falha — é informação.** É o sinal `cobertura` do ADR-012: "4 de 13 entidades ausentes" é resposta honesta e acionável.

**Mapeamento é editável e versionado**: alias e IA erram. O ProPlan mostra o que detectou, o usuário confirma ou corrige, e a decisão é persistida em **`.proplan/config.yml`** no repo-alvo:

```yaml
proplan: v2
mapping:
  architecture: docs/notas-tecnicas.md
  decisions: adr/          # diretório, não arquivo
  deploy: null             # confirmado ausente — não perguntar de novo
  testing: docs/qa/estrategia.md
```

**Princípio inegociável: o ProPlan nunca renomeia, move ou reescreve documento do usuário.** Ele mapeia. O repo do usuário continua exatamente como está — a adaptação é do ProPlan, não do projeto. Bootstrap de doc ausente é sempre **proposta**, revisada e aprovada.

### Corolário — convenção nossa não vira feature (a regra do segundo consumidor)

**Registrado em 2026-07-13.** O trio (PI · Cowork · Code) tem convenções **de processo**: `docs/specs/` com frontmatter `status: aprovada-pi`, o ciclo spec→issue→PR→aceite (ver `CLAUDE.md`). **Nada disso é feature do ProPlan.** Construir produto em cima da convenção que *nós* inventamos é **impor a nossa convenção aos repos-alvo** — exatamente o que este ADR proíbe.

É a **regra do segundo consumidor**, que o projeto já aplica a código (SPEC-003: *"não criar abstração antes do segundo consumidor"* — o write-back só virou compartilhado quando a Fatia 5 precisou), agora aplicada a **escopo de produto**:

> **Convenção só vira feature depois do segundo consumidor. Antes disso, é processo.**

**Teste de honestidade do gatilho** — a armadilha é auto-infligida: se o segundo repo adotar `docs/specs/` **porque queremos que o ProPlan leia**, fabricamos a demanda que depois vamos atender, e "dois repos usam" vira apenas *nós copiando a nós mesmos*. A pergunta que vale:

> *Aquele repo teria adotado essa convenção se o ProPlan não existisse?*

Se a resposta for **não**, continua sendo **uma** convenção — com dois arquivos. Gatilho não disparado.

**Refinamento da regra do ADR-011**: `.proplan/` passa a ser **"tudo que é do ProPlan"** — artefato gerado (`STATUS.md`) *e* configuração (`config.yml`). `docs/` continua sendo só o projeto. O cálculo de frescor do ADR-010 (`path=docs`) segue intacto.

**Onde o resolver mora — correção de 2026-07-13.** A primeira versão deste ADR (e a SPEC-006) diziam `board/domain`. **Estava errado.** O resolver não é composição de aba nem interpretação de conteúdo — nos níveis 1, 2 e 4 ele apenas **casa caminho**, o que é propriedade do **índice de documentos**. E o nível 3 é IA, que nunca pode encostar no caminho de renderização (ADR-002).

O resolver **não é padrão novo**: é o **padrão do ADR-002 aplicado a *caminho* em vez de *conteúdo*** — determinístico primeiro, IA como artefato versionado de fallback, nunca no render.

| módulo | responsabilidade | quando |
|---|---|---|
| **`ingestion`** | níveis **1, 2 e 4** — determinístico, sem IA. Convenção, alias e `.proplan/config.yml` (que ele já sincroniza e parseia). **Persiste a resolução.** | no `sync-job` |
| **`insight`** | nível **3** — classificação semântica. Job assíncrono, versionado por `docs_tree_sha`, escrevendo no mesmo store. **Perde** para config e alias. | após sync, se o hash mudou |
| **`board`** | **apenas consome** a resolução. **Nunca resolve nada.** | na renderização |

Alternativas rejeitadas: (a) *resolver inteiro no `insight`* — deixa a cauda balançar o cachorro (um nível de quatro usa IA) e faz o `board` depender do módulo de IA **só para renderizar uma aba**, aproximando a IA do render que o ADR-002 proíbe; (b) *resolver inteiro no `board/domain`* (a letra original) — dá ao `board` duas responsabilidades sem relação: Kanban e resolução de documentos; (c) *módulo novo dedicado* — boilerplate (module, wiring, DI) para uma escada e cinco parsers que cabem nos módulos que já são donos do dado.

**Consequência**: o mapeamento confirmado pelo usuário é, na prática, a **primeira asserção humana** do ADR-013 — o mecanismo aparece já no MVP1, o que valida o desenho antes do MVP2. Custo: mais uma superfície de UI (tela de mapeamento no onboarding do projeto) e uma tabela de alias para manter. Risco: alias agressivo demais casa arquivo errado com confiança de `fato` — mitigado porque o usuário revisa o mapeamento antes de ele valer.

## ADR-015 — GitHub App em vez de OAuth App; identidade de bot para escritas

**Status**: aprovado pelo PI em 2026-07-12. **Supersede o ADR-007** na parte de autenticação (Prisma como ORM continua valendo). Implementado na **Fatia 4.5** (SPEC-008), **pré-requisito da Fatia 5**.

**Contexto**: o ADR-007 escolheu **OAuth App** por simplicidade, com usuário único e ambiente local. Três coisas mudaram desde então:

1. A **Fatia 5 (ADR-011)** exige escopo de **escrita** em Issues — ou seja, **reconsentimento obrigatório de qualquer forma**. A janela para trocar o mecanismo de auth sem custo adicional é exatamente agora, e ela fecha quando a Fatia 5 for implementada.
2. O PI decidiu considerar **comercialização futura**. OAuth App não é o caminho: não instala por organização, não tem permissão granular, e o rate limit é do usuário, não da instalação.
3. Escopo de OAuth App é **grosso por construção** — `repo` concede leitura *e escrita* de tudo (a própria SPEC-001 registrou isso como limitação aceita). GitHub App concede permissão fina: "Contents: read", "Issues: write", e nada mais.

**Decisão**: migrar para **GitHub App**. Ele **absorve** o OAuth, não o elimina — passam a existir **dois tokens**, com papéis distintos:

| token | age como | usado para | vida |
|---|---|---|---|
| **user-to-server** (fluxo OAuth do App, `client_id` do App) | o usuário | **leituras**: listar repos, ler docs, ler issues — respeita a visibilidade real dele | expira; refresh token |
| **installation token** (JWT assinado com a chave privada do App → `POST /app/installations/{id}/access_tokens`) | **`proplan[bot]`** | **escritas**: commit da projeção, `.proplan/config.yml`, criar/mover issues | 1h; cacheado e renovado |

**Consequências boas**:

- **Identidade de bot**: todo commit e toda issue criada pelo ProPlan sai como `proplan[bot]` — nunca como Rodrigo. Auditoria limpa: dá para separar "o que o ProPlan fez" de "o que o humano fez" **por autor**, não por heurística de mensagem. Isso **não** revoga a decisão do `.proplan/` (ADR-011) — a separação de diretório continua sendo a defesa primária do ADR-010; o autor bot é um **segundo sinal**, redundante de propósito.
- **Permissão mínima**: `Contents: read+write` (só para `.proplan/`), `Issues: read+write`, `Metadata: read`, `Actions: read`, `Deployments: read` (SPEC-013, concedida em 2026-07-14 — só leitura de metadados de deployment GitHub-side, nunca conteúdo de código). Nada de `Administration`, nada de acesso a código além do que o ADR-003 já permite. A leitura de deployments usa **user-to-server token** (respeita a visibilidade do usuário), não o installation token — leitura com installation token permanece proibida.
- **Escritas sem o usuário presente**: installation token é server-to-server. Habilita jobs agendados no futuro (sync noturno) sem guardar token de usuário vivo.
- **Rate limit por instalação**, não por usuário — escala para multi-tenant sem mudança.
- **Webhooks nativos do App** quando o ADR-009 for revisto (deploy em nuvem).

**Custo aceito — atrito de instalação**: o App precisa ser **instalado** pelo dono em cada repo ou organização. O Catálogo deixa de listar "todos os repos que eu enxergo" e passa a listar **"repos onde o ProPlan está instalado"**, com CTA "Instalar em mais repositórios" (redireciona para a tela de instalação do GitHub). É mais atrito que OAuth — e é **consentimento explícito por repo**, que é exatamente o que uma versão comercial precisa ter. Trade-off assumido conscientemente.

**Custo aceito — chave privada**: o App tem uma chave privada (PEM) que precisa ser gerenciada como segredo (`GITHUB_APP_PRIVATE_KEY` em env, base64). Mais um segredo que o OAuth App não tinha.

**Alternativas rejeitadas**:
- *Manter OAuth App e reconsentir só o escopo de escrita* (Fatia 5): mais barato hoje, muito mais caro depois — migrar auth com usuários reais significa reconsentir todo mundo e migrar tokens. E deixa a identidade de bot na mesa, que é o que dá auditoria limpa.
- *GitHub App sem fluxo OAuth (só installation token)*: não autentica *quem* é o usuário — não há login. Inviável.
- *Usar installation token também para leitura*: o ProPlan passaria a enxergar tudo que o App enxerga, independentemente de quem está logado. Errado no dia em que houver mais de um usuário. Leitura é sempre com o token do usuário.

## ADR-016 — Uso de LLM é ledger append-only; custo é congelado na escrita

**Status**: aprovado pelo PI em 2026-07-12. Implementado na **Fatia 4.6** (SPEC-009). **Emendado pelo ADR-026 (2026-07-27)**: este ADR criou o teto sem dizer **de quem** ele é — o item 6 abaixo trata de provedores, não de donos. O ADR-026 decide que o teto pertence ao **tenant** (tabela `TenantSettings`), e não ao usuário. Tudo o mais aqui continua valendo.

**Contexto**: hoje o consumo de IA só aparece como colunas da tabela `insights` (`inputTokens`, `outputTokens`, `provider`, `model`). Parece suficiente — não é. `insights` é **cache de artefato**, chaveado por `docs_tree_sha` (ADR-002): ela guarda o *resultado* de uma inferência bem-sucedida. Três classes de gasto ficam invisíveis:

1. **Chamadas que falharam** — timeout, 429, erro do provedor. Token de input já foi cobrado.
2. **Retries** — a SPEC-003 prevê 1 retry em JSON inválido. A tentativa descartada não deixa linha.
3. **Artefatos não persistidos** — proposta de bootstrap que o usuário não aprovou; regeneração que sobrescreve a linha anterior e apaga o gasto passado junto.

Ou seja: usar `insights` como fonte de custo produz uma conta que **sempre subestima**, e que fica menos verdadeira quanto mais o produto falha — exatamente quando você mais precisa dela.

**Decisão**:

1. **Tabela própria, `LlmUsage`, append-only.** Uma linha por **chamada ao provedor** — sucesso, falha, retry, descarte. Nunca atualizada, nunca deletada, **nunca chaveada por hash de conteúdo**. `insights` continua sendo o cache do artefato; as duas coisas param de se confundir.
2. **O custo é calculado no momento da chamada e gravado na linha** (`costUsd`), junto do preço unitário usado (`priceSnapshot`) e da data dele. **Nunca recalculado.** Se o preço do modelo mudar amanhã, o gasto de ontem continua sendo o de ontem.
3. **Tokens de cache são de primeira classe.** A Anthropic devolve `cache_creation_input_tokens` e `cache_read_input_tokens`, com **preços diferentes** do input normal. Somá-los como input comum produz custo errado — e errado *para menos*. Colunas separadas.
4. **Preço vem de tabela configurável**, não de constante no código. Preço de modelo muda sem avisar; hardcode vira mentira silenciosa.
5. **Custo informado pelo provedor vence a nossa tabela.** O OpenRouter devolve o custo real da chamada; nossa tabela jamais acompanharia o catálogo dele. A linha grava `costSource: provider | table | none` — preferir o **fato** à nossa inferência, e **marcar qual dos dois é**. Mesma disciplina do ADR-012.
6. **Teto de gasto é global, nunca por provedor.** O ADR-008 garante um provedor ativo por vez; um teto por provedor daria 3× a exposição real com cara de 1×. Teto por provedor é teatro de controle.

**Consequência**: é o mesmo princípio do ADR-012 aplicado a dinheiro — **registrar o fato no momento em que ele é verdade, em vez de reinterpretá-lo depois**. Custo: uma tabela e uma escrita a mais por chamada de IA (irrelevante — a chamada de IA já custa 100× isso em latência). Risco aceito: preço mal configurado gera custo errado *na origem* — mas o `priceSnapshot` na linha deixa o erro **auditável e corrigível**, em vez de invisível.

**Alternativa rejeitada**: *derivar custo de `insights` na leitura, multiplicando tokens por uma tabela de preço atual*. Barato hoje, mentiroso amanhã: recalcular histórico com preço novo reescreve o passado, e continua cego a falhas e retries.

## ADR-017 — Uma fonte por fato: o MCP do ProPlan nunca replica o que o GitHub serve ao vivo

**Status**: aprovado pelo PI em 2026-07-13. Rege a **Fatia 11** (MCP Server). Evidência do levantamento em `docs/LANDSCAPE.md` (2026-07-13).

**Contexto**: o `MVP2.md` previa tools como `get_next_task` e resources com o estado do board. O levantamento de mercado (`LANDSCAPE.md`) mostrou que o **GitHub MCP Server oficial já expõe issues, PRs e Projects** — listar issue é chamada nativa e gratuita. Isso levantou a pergunta: *cortar tudo que o GitHub já faz?*

**A resposta simples estava errada.** "Cortar o que o GitHub faz" confunde duas coisas muito diferentes:

- `list_issues` do GitHub MCP devolve **uma lista**.
- `get_next_task` do ProPlan devolve **um julgamento**: *"pegue a #42; não a #38, que depende de uma decisão de arquitetura nunca tomada (sem ADR); não a #51, que você marcou como 'não mexer'; confiança 0.6, porque o `ARCHITECTURE.md` tem 8 meses"*.

O GitHub jamais dará isso — ele não conhece as asserções humanas (ADR-013) nem o apodrecimento da doc (ADR-010/012). **O julgamento é o produto.**

**Mas o instinto de cortar apontava para uma regra real — e ela é de corretude, não de posicionamento competitivo.**

**Decisão**: **o ProPlan nunca é a segunda fonte de um fato que o GitHub serve ao vivo.**

| tipo | exemplo | decisão |
|---|---|---|
| **Pass-through** de fato que o GitHub já serve | listar issues, corpo de issue, estado de PR, resultado de check | **Não expor.** O agente usa o GitHub MCP — que sempre estará mais fresco que nós |
| **Julgamento** sobre esses fatos | `get_next_task`, `find_blockers`, drift, confiança, handoff | **Expor.** É o produto |
| **O que só existe no ProPlan** | `get_constraints` ("o que não mexer"), "por que parei" (ADR-013) | **Expor. É o fosso** — nem o GitHub tem (o Copilot Memory exige citação de código, e essas asserções não têm código para citar) |

**Corolário de desenho**: as tools do ProPlan **referenciam** a issue (número + URL), **nunca a reproduzem**. Entregamos a decisão e a evidência; o agente busca o detalhe na fonte.

**Por que isso é corretude e não estratégia**: sem webhooks (ADR-009), nosso cache de issues está sempre potencialmente defasado. Se o MCP servir esse cache como fato, o agente pode consultar o ProPlan e o GitHub MCP **na mesma sessão e receber respostas diferentes** — e não tem como saber qual está certa. Ele não vê botão de "Sincronizar"; **ele age**. É a pior classe de bug que existe aqui: dado velho com aparência de autoridade.

**A assimetria que justifica o Kanban continuar como está**: a UI do ProPlan *pode* ler o cache — o humano vê o botão Sincronizar e sabe que aquilo é uma foto. O agente não. **Cache é ótimo para renderizar, péssimo para servir como fato a quem vai agir sobre ele.** O board (Fatia 5) não muda.

**Consequências**: o MCP do ProPlan fica **menor e mais afiado** — some a tentação de virar proxy de GitHub. Custo: o agente precisa de **dois** servidores MCP conectados (o do GitHub e o nosso), e o nosso depende do outro para ser útil. Aceito: complementar, nunca competir — foi a tese desde o começo.

## ADR-009 — Sem webhooks enquanto o ambiente for 100% local

**Contexto**: a arquitetura previa webhook `push` do GitHub para sync incremental, mas GitHub não alcança `localhost` — exigiria túnel (smee/ngrok), que é infraestrutura frágil e contradiz a regra "100% local até o fim do MVP".
**Decisão**: nenhum webhook no MVP. Reconciliação: (a) re-sync automático após cada commit feito pelo próprio ProPlan (bootstrap, Kanban); (b) botão Sincronizar para mudanças externas; (c) opcional futuro: polling agendado por projeto. Webhook volta quando existir endpoint público (deploy em nuvem), reaproveitando o desenho da ARCHITECTURE.md.
**Consequências**: mudanças feitas fora do ProPlan só aparecem em sync manual — aceitável para usuário único que sabe quando mexeu no repo. O código de sync não muda; só o gatilho.

## ADR-018 — Probe HTTP não-autenticado de URL declarada como sinal de deploy

**Status**: **aprovado pelo PI em 2026-07-14**. Rege a **Fatia 13.6** (probe do drift de deploy). Complementa a **SPEC-013 v2.1**, que embarca **sem** probe. As 7 guardas SSRF-safe abaixo são **condição de aceite da 13.6**, não recomendação.

**Contexto**: a SPEC-013 confronta 4 fontes de plataforma de deploy (doc, config no repo, GitHub Deployments, URL declarada). Três são **registro ou asserção**; nenhuma toca a realidade. O caso `rrb-escola` provou o custo disso (2026-07-14): toda fonte GitHub-side aponta Vercel — por resíduo e congelamento — enquanto a produção real (Netlify+Railway) é **invisível** a elas. A v2.1 extrai a plataforma do **domínio** da URL declarada por parse de string (sem chamada externa), o que resolve URLs com domínio-de-plataforma (`*.netlify.app`), mas **não** domínio próprio (`gestao.epgtrindade.com.br`) e **não confirma liveness** (a URL declarada pode estar velha).

**O que o probe adiciona, e por que é on-thesis**: um GET HTTP à URL declarada é a **única fonte que confronta o mundo** — confirma que aquela URL **está no ar servindo aquela plataforma agora**, e identifica plataforma de **domínio próprio** pelos headers de resposta (`x-vercel-id`, `x-nf-request-id`, `server`, `via`, `x-railway-*`). É a materialização da tese do `LANDSCAPE.md` (*"falta o confronto com o mundo"*).

**Por que não entrou na SPEC-013**: o probe é o **único ponto da fatia que abre superfície de segurança séria** — **SSRF** (o servidor busca uma URL fornecida pelo usuário). Um probe ingênuo permite apontar o backend do ProPlan para `169.254.169.254` (metadata de cloud), `localhost` ou IP interno. A instância de deploy não é a hora de improvisar isso; o probe recebe fatia e revisão de segurança próprias.

**Decisão**: autorizar o probe **somente** na forma de **fetch endurecido (SSRF-safe)**, com todas as guardas abaixo — não-negociáveis:

1. **Só `https`** (rejeita `http`, `file:`, `gopher:`, `ftp:`, etc.).
2. **Resolver o DNS e rejeitar destino não-público**: privado (RFC1918), loopback (`127/8`, `::1`), link-local (`169.254/16` — mata o metadata endpoint), CGNAT (`100.64/10`), `fc00::/7`. Checagem **após** resolução, não sobre o hostname.
3. **Re-validar a cada redirect** (mesma checagem de IP), **teto de 3 saltos**, sem troca de esquema. Rebind/redirect para IP interno é bloqueado no salto.
4. **`HEAD` primeiro; `GET` com corpo limitado** (teto ~64KB), **timeout curto** (~5s).
5. **Só URLs declaradas pelo dono** no `.proplan/config.yml` — **nunca** URL descoberta, extraída de doc, ou arbitrária. Rate-limit por sync.
6. **Zero credencial na saída** — sem header de auth, sem cookie. O probe é anônimo.
7. **Persistir só o veredito** (plataforma + data), **nunca o corpo** da resposta (ADR-017). Roda no **sync-job**, nunca no caminho de render (ADR-002).

**Fronteira que permanece**: isto autoriza **probe HTTP público anônimo**, não integração com **API de plataforma** (Railway/Netlify/Vercel com credencial) — essa continua fora (o "outro produto"); o ProPlan roda para qualquer repo e não pode assumir provedores conectados.

**Relação com o ADR-003**: observar a **resposta pública** de uma URL não é ler código nem clonar repo — o tabu do ADR-003 (blob de código-fonte, Code Search, diffs) permanece intacto. É superfície **externa nova** (daí exigir ADR próprio), da natureza dos metadados já autorizados nos adendos ao ADR-003, mas dirigida à plataforma, não ao GitHub.

**Consequências**: com o probe, o `rrb-escola` vira `discordam` mesmo em domínio próprio, e o produto ganha a única fonte que reflete a realidade. Custo: uma superfície SSRF que **exige** as 7 guardas acima e manutenção de segurança contínua. Sem aprovação do PI a este ADR, a Fatia 13.6 não codifica e a SPEC-013 v2.1 (sem probe) é o teto.

## ADR-019 — Relatório de testes gerado pelo CI; evidência de máquina, nunca narrada

**Status**: **aprovado pelo PI em 2026-07-15**. Rege **processo/infra de desenvolvimento do repo**, não o runtime do produto ProPlan. Referência de implementação: `docs/TESTING.md`.

**Contexto**: queríamos um resumo de testes por SPEC/issue ao fim de cada entrega (quantidade, pass, falha, cobertura, tipo de teste). O primeiro instinto — um `TEST.md` que o Claude Code escreve resumindo os próprios testes — é **auto-relato**: exatamente o *fechamento frágil* que o produto existe para detectar. "410 testes verdes" digitado por um agente é uma afirmação, não evidência. Um arquivo assim ainda violaria fonte única (ADR-011, pois qtde/cobertura já vivem no PR e no CI) e, se colocado em `docs/`, zeraria o relógio do alerta de doc defasada (ADR-010) a cada entrega.

**Decisão**: a evidência de teste é **gerada por máquina e verificada no CI**, nunca narrada.

1. **Fonte dos números**: saída `--json` dos runners (`jest`/`vitest`/`playwright`). Nenhum número é escrito à mão.
2. **Arquivo-registro**: `reports/TESTS.md` — diretório neutro na raiz. **Não** em `docs/` (mascararia ADR-010) nem em `.proplan/` (artefato do produto em repos-alvo). Cabeçalho "GERADO — NÃO EDITAR". Registro **incremental** (append por entrega): 3 linhas por entrega (**Banco / Regras de Negócio / Tela**) — a categoria é o tipo de teste.
3. **Categorias por convenção, sem hardcode**: mapa categoria→diretório em `test-report.config.json`; sufixos `*.spec.ts` (Regras), `*.int-spec.ts`/`*.e2e-spec.ts` (Banco), `*.test.tsx`/`e2e/` (Tela).
4. **Guarda anti-drift**: `pnpm test:report --check` recomputa os números da issue atual numa execução limpa e **falha o CI** se divergirem do commitado. É o que torna o arquivo confiável — o número só cola se sobreviver a uma reexecução independente.
5. **Publicação**: `$GITHUB_STEP_SUMMARY` + comentário fixo no PR. Cobertura é **report-only** (não barra merge). Nada de `closes #N`; o CI torna a evidência infalsificável, mas o aceite continua sendo ato deliberado do PI (ADR-011).
6. **Operacional**: comando `pnpm test:report`; Playwright em job separado, sempre; Redis no CI só se um teste de integração exercitar BullMQ de verdade.

**Consequências**: ganhamos o "print de testes verdes" como evidência infalsificável, tocada à fonte de verdade (o PR), sem produzir o auto-relato que o produto combate. Custo: montar `apps/web` do zero para testes (Vitest + Testing Library + Playwright) — hoje não há runner de tela; tratar como esforço próprio. Tooling é portável para projetos futuros (workflow + gerador + config), cumprindo o objetivo de já vir "de fábrica". Esta é a **primeira ADR de processo** no arquivo — governa como desenvolvemos, não a arquitetura do produto.

## ADR-020 — Isolamento multi-tenant: RLS com contexto por array de membership; bypass proibido

**Status**: **aprovado pelo PI em 2026-07-17**. Rege a **Fatia 8** (SPEC-022). Consolida em nível de ADR o que a SPEC-022 já decide — para a regra sobreviver à spec e ficar greppável.

**Contexto**: RLS é a **fronteira de segurança entre donos diferentes** (isolamento real, não organização lógica). A SPEC-021 tem uma **rota global** — o catálogo em `/` — que lê projetos de **todos** os tenants de que o usuário é membro. Um contexto RLS **singular** (`app.tenant_id`) não serve essa leitura: ou deixa o catálogo em *fail-closed* (zero linhas), ou empurra para **desligar RLS na query mais ampla do sistema** — o pior lugar para abrir mão da rede. (A SPEC-022 nasceu singular e não mencionava o catálogo; corrigido pela emenda de 2026-07-17.)

**Decisão**: o contexto RLS é o **array de tenants de membership** do usuário (`app.tenant_ids`), não um id só. Uma policy — `tenant_id = ANY (current_setting('app.tenant_ids', true)::uuid[])` — serve **rota escopada** (`/t/:tenant`, array de 1) e **rota global** (catálogo, array completo). Regras não-negociáveis:

1. O array é derivado do `userId` **autenticado** (via `identity`), **nunca** de input do cliente (body/query/header) — senão o RLS vira teatro.
2. `SET LOCAL` **transaction-scoped** (nunca `SET` de sessão — vaza no pool do Prisma).
3. *Fail-closed*: sem contexto, `= ANY(NULL)` → **zero linhas**. Nunca defaultar para "todos".
4. **Proibido**: bypass de RLS, role `BYPASSRLS`, conexão como owner para leitura global. A garantia mora no **banco**, não no service. Checagem no CI barra o merge que reintroduzir bypass.

**Consequências**: o catálogo lê cross-tenant **sob RLS**, com uma policy só (simplifica, não incha). Custo: a rota global monta o array de membership por request — um passo, o **elo crítico**, que deriva da identidade autenticada. Este ADR existe para que ninguém reabra bypass "só para um relatório" sem confrontar a decisão datada. Complementa ADR-015 (auth/tenant) e ADR-016 (teto e ledger de IA).

**Correção (2026-07-27)**: a frase acima dizia *"ADR-016 (teto de IA **por tenant**)"* — e o ADR-016 nunca decidiu isso. Era comportamento entregue na Fatia 8 descrito como se fosse decisão registrada. Quem decide o teto por tenant é o **ADR-026**, datado de hoje.

## ADR-021 — Identidade é o GitHub App no MVP; login genérico (Google/outros) desacoplado das conexões fica para o módulo `identity`

**Status**: **aprovado pelo PI em 2026-07-20**. Não altera código no MVP — registra uma decisão de *não fazer agora* e a costura que a viabiliza depois. Complementa ADR-015 (auth) e ADR-020 (tenant); não toca SPEC-021 (login/catálogo), que segue de pé.

**Contexto**: o PI levantou trocar o ponto de entrada — **login pelo Google → catálogo → e só então a integração com o GitHub** —, motivado por o ProPlan "não ser só git" (ideias futuras de outras fontes). A pergunta embutida era se isso resolveria o item pendente *"Configurações: desconectar/reconectar o GitHub App"*.

**Por que não agora**:

1. **Não resolve o problema que motivou a pergunta.** Desconectar/reconectar o GitHub App é um fluxo de **conexão**, ortogonal à **identidade**. A conexão pode ser revogada, expirar ou precisar de re-consent independentemente de quem é o IdP primário — a tela de Configurações é necessária com Google ou com GitHub. Trocar a identidade não elimina esse botão.
2. **Conflita com o modelo de dois tokens do ADR-015.** Toda **leitura** usa o token **user-to-server** do GitHub, que respeita a visibilidade real do usuário (leitura com installation token é proibida). Se o Google vira a identidade, o token user-to-server do GitHub **ainda precisa existir e ser vinculado** — o OAuth do GitHub não sai de cena, o Google entra **por cima**. Resultado: mais superfície de auth, não menos.
3. **Contradiz "single-user + 100% local até o fim do MVP".** Google OAuth é um segundo IdP externo (registro de app, callback, nuvem) para um sistema de **um usuário** que **precisa** conectar o GitHub para fazer qualquer coisa. Login Google no MVP é uma credencial a mais sem benefício — atrito puro.

**Decisão**:

- O **MVP mantém o GitHub App como identidade** (SPEC-021/ADR-015 intactos). Não reabrir agora.
- A tela **desconectar/reconectar o GitHub App** é especificada **independentemente** desta discussão (SPEC-025) — é o item que estava na fila e continua valendo.
- A intuição de **desacoplar identidade das conexões** é correta e fica **desenhada como costura**: o módulo `identity` (que **já existe** — hoje GitHub-App-auth *é* a identidade) passa a **não hardcodar GitHub como IdP**; conexões (GitHub App hoje; GitLab/Jira/Notion amanhã) são recursos plugáveis pendurados numa identidade, não a identidade em si. É **refatoração** de módulo vivo, não greenfield (ver SPEC-026). Construir o login genérico é YAGNI até haver segunda fonte ou multi-tenant.

**Gatilho de revisão**: quando entrar **segunda fonte de ingestão** (não-GitHub) **ou** multi-tenant/comercialização — aí a identidade genérica + conexões plugáveis passam a ter razão real, e este ADR vira o ponto de partida.

**Alternativa rejeitada**: *trocar já a entrada para Google + integração GitHub posterior*. Resolve um problema que não temos (multi-fonte) e não resolve o que temos (desconectar/reconectar), ao custo de reabrir o ADR-015 e furar o local-only.

**Atualização 2026-07-20 (mesmo dia, após esclarecimento do PI)**: o PI apontou o caso de uso concreto que torna a separação valiosa — com identidade separada, **desconectar deixa de ser deslogar**: a sessão do app sobrevive à perda do GitHub e o usuário fica dentro do produto (catálogo com botão *conectar GitHub*), podendo usar features que não dependem do GitHub. Decisão refinada:

- **Nada muda no MVP1.** Continua GitHub-como-identidade; nada a codificar agora.
- A costura **identidade ⊥ conexão, com Google como primeiro IdP**, é o **primeiro item pós-MVP1** (fora do escopo/tese do MVP2 em `docs/specs/MVP2.md`, que é memória verificável — esta é outra frente). Desenhada agora, codificada depois. Spec: **SPEC-026** (`aprovada-pi` 2026-07-20). Decisões: encerra o "100% local" (+ IdP fake no dev) · `Connection` 1:N no schema, 1 na UI · migração automática no 1º login pós-deploy · sem feature não-GitHub por ora (costura dormente).
- No mundo pós-costura, **desconectar é não-destrutivo → cai no Catálogo** (mantém a sessão do app; projetos viram cards read-only com selo "GitHub desconectado"). Spec: **SPEC-025** (`aprovada-pi` 2026-07-20, depende da SPEC-026). Botão **"Desconectar GitHub"** em vermelho, distinto de **"Sair da conta"**.
- Google-como-IdP deixa de ser YAGNI **porque** a frente pós-MVP1 já assume multi-usuário/comercialização (a janela do ADR-015). A costura permanece **IdP-plugável** e **conexão-plugável** (GitHub hoje; GitLab/Jira/Notion depois) — não amarra o produto ao Google nem ao GitHub.
- **Ponto de integração a respeitar**: a identidade (venha do Google) precisa alimentar o **mesmo módulo `identity`** de que o ADR-020 deriva o array de membership de tenant; e a leitura continua exigindo o token user-to-server do GitHub (ADR-015) — *conectar GitHub* segue sendo o OAuth do App inteiro, só reposicionado no catálogo.

## ADR-022 — Encerramento do "local-only": produção no Railway, DNS na Hostinger, Supabase reservado

**Status**: **aprovado pelo PI em 2026-07-21**. Implementado na SPEC-027 (issue #103). Revoga a regra *"ambiente 100% local até o fim do MVP; sem deploy em nuvem"* do `CLAUDE.md`. Runbook operacional: `docs/DEPLOY.md`.

**Contexto**: o local-only existia para evitar gastar tempo com infra antes de haver produto. O produto existe: MVP1 entregue e o MVP2 já pressupõe deploy (o `DEPLOY.md` "precisa ter onde escrever"). Manter a regra passou a custar mais que levantá-la — o ADR-021 e a SPEC-026 já citavam "encerra o 100% local" como pré-requisito de frentes suas.

**Decisão**:

- **Compute, banco e fila num só provedor: Railway.** Quatro serviços no mesmo projeto (`web`, `api`, `Postgres`, `Redis`), compartilhando a rede privada.
- **Hostinger só resolve DNS** (`proplan.rrbtrading.com.br` e `api.proplan.rrbtrading.com.br` → Railway). Nenhum arquivo hospedado lá.
- **Supabase fica reservado, sem função ativa.** O free tier pausa após 7 dias sem request — impróprio para uma app que fica ociosa. Se um dia entrar (ex.: object storage), exige ADR próprio dizendo **que dado** vai para lá.
- **CI/CD**: auto-deploy no push para `main`; `prisma migrate deploy` roda como release command **antes** de o processo assumir tráfego. Migração que falha aborta o deploy e mantém a versão anterior no ar.

**Por que um provedor só** (e não banco no Supabase + compute no Railway):

1. **Cookie same-site sem gambiarra.** web e api sob o mesmo domínio registrável ⇒ `SameSite=Lax` basta; `SameSite=None` fica fora.
2. **Sem egress entre provedores** e latência de rede privada entre api↔banco↔fila.
3. **Custo marginal**: a conta é Railway Pro, então o Postgres não adiciona assinatura — paga-se consumo.

**O que esta decisão obriga no código** (o que a SPEC-027 entregou): imagens de produção para api e web; `/health` para o healthcheck; leitura de `PORT`; `secure` nos cookies quando em produção; e o **bootstrap explícito da role não-owner `proplan_app`** — o init do Docker que a cria no dev **não roda** no Postgres gerenciado.

**Risco aceito, com guarda**: rodar a app como owner/superuser desliga o RLS **silenciosamente** (o Postgres pula RLS para essas roles) — o isolamento multi-tenant do ADR-020 viraria no-op sem nenhum erro visível. Por isso `scripts/bootstrap-app-role.mjs` **falha explicitamente** se a role tiver `rolsuper`/`rolbypassrls`, e a `DATABASE_URL` de runtime aponta para `proplan_app`, nunca para o owner (que fica só na `DIRECT_URL`, para migrations).

**Fora desta decisão**: staging/preview (só produção por ora), webhook do GitHub, observabilidade/alertas e qualquer migração destrutiva — cada um com sua fatia. O **servidor MCP não vai para o Railway**: a SPEC-016 o define como processo **local (stdio)**, sem porta HTTP; um container dele subiria sem nada para conversar.

**ADR-003 intacto**: deployar o próprio ProPlan não é o ProPlan inspecionando infra alheia. Ele continua lendo apenas `docs/` dos repos-alvo.

**Gatilho de revisão**: multi-tenant comercial com carga real (hoje o Postgres é single-instance sem réplica), necessidade de staging, ou custo do Railway saindo do crédito do Pro.

---

## ADR-023 — O funil de clientes é estado do app; o ADR-011 vale para o board de repos

**Status**: **aprovado pelo PI em 2026-07-25** (decisão fundadora 4 do `docs/specs/MVP3.md`). Implementado na SPEC-029 (issue #127). **Não revoga nem enfraquece o ADR-011** — delimita o domínio de cada um.

**Contexto**: o ADR-011 estabelece que *"estado do trabalho vive nas GitHub Issues"* — o board de repos não tem coluna no banco, porque a garantia que ele vende é justamente **não poder forjar aceite**: a issue só fecha por ato deliberado do dono. Essa garantia depende de o estado morar num lugar que a aplicação não controla sozinha.

O MVP3 traz um segundo Kanban — o **funil de clientes** (`Novo/Link enviado · Briefing · Prompt e contrato · Produção e entrega`). Ele parece o mesmo problema, mas não é: um cliente do prestador **não tem repositório**, não tem issue e não tem GitHub. Não há onde colocar esse estado fora do banco.

**Decisão**: os dois Kanbans existem, com fontes de verdade **diferentes e disjuntas**:

| board | fonte de verdade | por quê |
|---|---|---|
| **Board de repos** (fatias/issues do projeto) | **GitHub Issues** (ADR-011) | O aceite é do dono e não pode ser forjado por automação |
| **Funil de clientes** (MVP3) | **Banco do app** (`client_projects.state`) | Não há entidade externa: o cliente não é um repo |

- Transições do funil são validadas **no servidor** por máquina de estados no `domain/` do módulo `clients` — a UI é otimista e faz rollback quando o servidor recusa (422).
- Toda mudança grava `ClientStatusTransition` (de, para, ator, quando). É o que substitui, neste domínio, o histórico que as Issues dão de graça no outro.
- **Nenhum fato mora nos dois lugares.** O funil de clientes nunca cria, move ou fecha issue; o board de repos nunca lê `client_projects`.

**O que esta decisão NÃO autoriza**: mover o board de repos para o banco. A tentação vai aparecer ("já temos máquina de estados, por que não usar nos dois?") — e a resposta é a mesma do ADR-011: no board de repos, estado no banco significa que a aplicação pode declarar "feito" sozinha, que é o *fechamento frágil* que este produto existe para detectar.

**Gatilho de revisão**: se um cliente do prestador passar a ter repo próprio no ProPlan (a frente comercial encontrando a frente de repos), reavaliar se os dois boards continuam disjuntos.

---

## ADR-024 — `Tenant` existe sem instalação do GitHub (`installationId` nullable)

**Status**: **aprovado pelo PI em 2026-07-25** (decisão fundadora 3 do `docs/specs/MVP3.md`). Registrado na SPEC-029 (issue #127). Coerente com o ADR-021 e as SPEC-025/026.

**Contexto**: o `Tenant` nasceu (SPEC-022, Fatia 8) como *dono de projetos de repositório*, atrelado a uma instalação do GitHub App. O MVP3 traz uma frente onde **não há repositório nenhum**: o prestador cadastra clientes e projetos de cliente, e nada disso toca o GitHub. Exigir instalação para existir um tenant travaria a frente inteira numa dependência que ela não usa.

**Decisão**: `Tenant.installationId` é **nullable** — um tenant existe sem instalação do GitHub. "Workspace" segue sendo o nome de UI do `Tenant`: **uma tenancy, um RLS (ADR-020), uma `Membership`**, independente de haver GitHub por trás.

**Constatação de implementação**: a coluna **já era nullable desde a migration da Fatia 8** (`installation_id INTEGER`, sem `NOT NULL`) — ela nasceu assim porque o tenant pessoal já podia existir antes da instalação de org. Este ADR **não gerou DDL**; ele torna explícita e deliberada uma propriedade que até aqui era acidente de implementação, e que a frente de clientes passa a depender.

**Consequência**: ausência de instalação é **informação, não falha** — mesma semântica da `Connection` ausente na SPEC-025. Catálogo e sync já tratam o caso (o tenant sem instalação simplesmente não lista repos); nenhuma rota da frente de clientes consulta `installationId`.

**O que continua valendo**: a leitura de repositório segue exigindo o par de tokens do ADR-015 (user-to-server para ler, installation para escrever). Um tenant sem instalação não lê repo nenhum — ele só não deixa de existir por isso.

**Gatilho de revisão**: criação de workspace pela UI sem GitHub (fora do escopo da SPEC-029) — quando entrar, revisar se `accountLogin`/`accountType`, hoje `NOT NULL` e preenchidos pela instalação, continuam fazendo sentido obrigatórios.

## ADR-025 — Binário enviado por cliente vive no Postgres, sob RLS, com limite duro e prazo de validade

**Status**: **aprovado pelo PI em 2026-07-26**. Exigido pela SPEC-031 (anexos do briefing público, issue #138). Responde à pergunta que a `docs/DEPLOY.md` §8 deixou explícita: *"se o Supabase entrar como object storage, exige ADR próprio dizendo **que dado** vai para lá"*.

**Contexto**: até aqui o ProPlan nunca guardou binário. Ele lê documentação por API (ADR-003), não clona repositório e não recebe upload — a única escrita de arquivo que existe vai para o repo do usuário, via GitHub. A SPEC-031 quebra isso: o cliente do prestador anexa logo, PDF e referências no briefing público. E o produto **não tem object storage** — o Supabase está provisionado e deliberadamente **reservado** (ADR-022), sem papel ativo.

Três candidatos, e o critério que decide não é custo nem elegância: é **isolamento**. Anexo de briefing é dado de cliente de um tenant específico, e o ADR-020 estabeleceu que isolamento neste produto é garantido por **RLS no banco**, com bypass proibido e teste de fail-closed no CI. Qualquer storage fora do Postgres move essa garantia para dentro do código da aplicação — que é exatamente onde ela é mais fácil de furar por esquecimento.

**Decisão**:

1. **Os bytes ficam em coluna `bytea` na tabela `file_assets`**, raiz com `tenant_id`, `ENABLE`+`FORCE` RLS — mesmo desenho das tabelas da SPEC-022/029. O anexo herda o isolamento, o backup e o ponto-no-tempo do banco sem código novo.
2. **`bytea`, nunca Large Object (`lo_`).** LO vive fora da tabela, num catálogo próprio: escapa da policy de linha e exige API dedicada. `bytea` é só uma coluna — a policy da linha vale para ele. O TOAST cuida de comprimir e armazenar fora da página.
3. **Limites duros, aplicados no servidor**: 10 MB por arquivo, 25 MB e 5 arquivos por briefing, allowlist de MIME (`png`, `jpeg`, `webp`, `pdf`), tipo verificado pela **assinatura de bytes** — nunca pelo `Content-Type` do request nem pela extensão. Fora do limite: recusa, e nada é gravado.
4. **Acesso sempre por identificador, nunca por caminho**: `GET /t/:tenant/files/:id`, autenticado, com URL assinada de vida curta, `Content-Disposition: attachment` e `Content-Type` fixo do allowlist. Nenhuma rota serve o arquivo pela origem da aplicação como conteúdo renderizável.
5. **Gatilho de revisão** — esta decisão tem prazo, e ele é numérico. Revisar quando **qualquer um** ocorrer:
   - soma de `file_assets` passar de **2 GB**;
   - aparecer demanda por arquivo **acima de 10 MB** (vídeo, `.psd`, pacote de assets);
   - `pg_dump`/restore passar de **10 minutos** ou o custo de storage do Railway virar linha visível na fatura;
   - surgir um **segundo caso de uso** de binário (exports e artefatos das SPEC-033/035 são os candidatos óbvios).

   Disparado o gatilho, nasce ADR novo escolhendo object storage. **A migração é cópia, não redesenho**: como o acesso já é por `id` atrás de uma rota assinada (item 4), trocar a origem dos bytes não toca a UI nem o modelo — só a implementação do repositório.

**Consequência**: o banco engorda com dado que não é relacional, os dumps ficam mais pesados e cada leitura carrega o arquivo inteiro em memória (aceitável com teto de 10 MB; subir o teto cai no gatilho). Em troca, o anexo nasce com isolamento por RLS provado pelo mesmo teste que protege o resto, entra no backup existente e **não** adiciona fornecedor, credencial nem procedimento operacional novo ao runbook.

**Alternativas rejeitadas**:

- **Volume do Railway** — banco magro, mas o isolamento entre tenants passaria a ser código nosso em vez de policy do banco (contra o espírito do ADR-020), o backup viraria um segundo procedimento no `DEPLOY.md` e o volume prende a API a uma instância, matando escala horizontal por um motivo lateral.
- **Ativar o Supabase Storage** — tira o Supabase da reserva por um caso de uso de 25 MB, traz um segundo fornecedor para o caminho de dados e herda o free tier que **pausa após 7 dias sem request** (ADR-022) — exatamente o motivo pelo qual ele foi engavetado. Se algum dia o volume justificar object storage, a escolha se faz na hora, com o número na mão, e não agora por antecipação.

## ADR-026 — Teto de gasto de IA pertence ao tenant, não ao usuário

**Status**: **aprovado pelo PI em 2026-07-27**. **Emenda o ADR-016** (que criou o teto sem dizer de quem ele é) e o fecho do ADR-020 (que já o chamava de "por tenant" sem que isso estivesse escrito em lugar nenhum). Exigido pela SPEC-032 (Fatia 21, issue #147) — é o 1º dos dois pré-requisitos dela, e o outro depende deste.

**Contexto**: o ADR-016 criou o ledger `LlmUsage` e o teto de gasto. O texto dele **nunca diz "por tenant"** — o item 6 diz *"teto é global, nunca por provedor"*, e isso é sobre **provedores**, não sobre donos. A Fatia 8 (SPEC-022) trouxe multi-tenancy e, na prática, escopou o gasto: `LlmUsage.tenantId`, soma sob `withTenant`, comentário no `usage.service.ts` afirmando *"o gasto é POR TENANT (ADR-016)"* e a linha de fecho do ADR-020 dizendo o mesmo. Ou seja: **o produto se comporta há duas fatias como se esta decisão existisse, e ela nunca foi tomada.** Metade deste ADR é ratificação datada disso — dizer na cara é melhor que fingir que sempre esteve escrito.

A outra metade é decisão nova, e ela aparece porque a SPEC-032 quebra duas coisas de uma vez:

1. **A chave é a pessoa, não o tenant.** `Settings.userId` é `@unique`; `capsOf(userId)` resolve `personalTenantId(userId)`, que é `membership.findFirst({ where: { userId }, orderBy: { role: 'asc' } })`. O teto pertence a **um usuário** e o `tenantId` é acompanhante. Num tenant com dois membros existem **dois tetos** sobre **a mesma soma** — o resultado do gate depende de quem chamou. Isso não é "teto por tenant"; é "teto por usuário, medido no tenant dele". Enquanto o produto foi de usuário único, a distinção não custou nada.
2. **Nem sempre existe um usuário.** O pipeline da SPEC-032 dispara do envio de um briefing **público, por cliente anônimo**. Não há `userId` no contexto, e `canSpend(projectId)` ainda recebe o `Project` errado (repo do GitHub, não `ClientProject`). O gate atual é **literalmente inalcançável** a partir do caminho que mais precisa dele — o único onde quem gasta o dinheiro não é quem paga.

**Decisão**:

1. **Teto e alerta são do tenant**, em tabela nova `TenantSettings` (`tenant_id` único, `ENABLE`+`FORCE` RLS como as demais raízes). As colunas `llm_alert_usd_monthly` e `llm_hard_cap_usd_monthly` **saem** de `settings`. `Settings` continua existindo como preferência de **usuário** (provedor, limiares de UI, limiar de recusa canônica) — o que sobra lá é escolha pessoal, não bolso.
2. **`capsOf` recebe `tenantId`, nunca `userId`.** Nenhum caminho do sistema resolve teto a partir de pessoa. `personalTenantId` deixa de ser usado para dinheiro (segue servindo às preferências).
3. **Migração: vence o teto do `owner`.** Havendo mais de um `owner` no tenant, vence o de `Membership.created_at` mais antiga. Tenant sem `owner` (não deve existir) recebe o padrão do schema. **É one-way e perde dado de propósito**: os tetos configurados por não-`owner` desaparecem. Eles nunca representaram o bolso de ninguém — representavam uma leitura pessoal de um limite compartilhado.
4. **Só `owner` altera o teto.** `member` e `viewer` **leem** (o `member` "vê custo", ADR-015/enum `Role`) e não escrevem. Teto é decisão de quem paga a fatura, e é o mesmo papel que já é o único a finalizar issue (ADR-011).
5. **O gate roda com tenant explícito, inclusive fora de request.** Job não tem sessão: resolve o tenant a partir do id do agregado que está processando e abre o próprio `runInTenantContext` antes de somar. Somar sob RLS *fail-closed* sem contexto **não dá erro — dá zero**, e zero passa no gate. Esta frente já acumulou 5 ocorrências desta classe, todas com a suíte verde.
6. **Continua valendo do ADR-016, sem alteração**: o teto é global **entre provedores** (o bolso é um só); o ledger é append-only; o custo é congelado na escrita com `priceSnapshot`; chamada com `priceMissing` não entra na soma e o aviso correspondente não pode ser escondido.

**Consequência**: o teto passa a ter **um** lugar e **um** dono, e o gate fica chamável de qualquer caminho — inclusive de job disparado por anônimo, que é o caso que motivou tudo. Custo: uma tabela nova, uma migração destrutiva por decisão, e um `capsOf` cuja assinatura muda em todos os call sites. Efeito colateral aceito: num tenant com vários membros, quem não é `owner` perde o botão que tinha (mesmo que o botão nunca tenha feito o que ele achava que fazia).

**Este ADR bloqueia o outro.** A extração do módulo `llm` (2º pré-requisito da SPEC-032) expõe uma porta de gate para o módulo `artifacts`; se essa porta nascer recebendo `userId`, nasce errada. **Sequencial, não paralelo.**

**Alternativas rejeitadas**:

- **Manter em `settings` e desempatar dentro do `capsOf`** (ex.: "vence o do owner", resolvido em código). Mais barato hoje e não exige migração. Rejeitado porque deixa a ambiguidade **no código em vez de no modelo**: `settings` continuaria tendo N linhas com um teto cada, e quem abrisse a tabela — ou a tela — continuaria lendo "meu teto" onde o número não é de ninguém. Regra que só existe numa função é regra que a próxima query esquece.
- **Colunas de teto direto no `Tenant`.** Uma tabela a menos. Rejeitado porque mistura identidade de tenancy com configuração de billing: `Tenant` viraria gaveta conforme outras configurações por tenant aparecerem, e a primeira delas já está encomendada (mapeamento de complexidade→acabamento, SPEC-033).
- **Teto por `ClientProject` ou por briefing.** Controle mais fino e atraente para cobrar do cliente final. Rejeitado pelo **mesmo argumento do item 6 do ADR-016 contra teto por provedor**: o bolso é um só, e N tetos parciais dão a sensação de controle enquanto a exposição real é a soma deles. Se um dia for preciso limitar por projeto, isso é **quota**, não teto — nome diferente, ADR diferente.

## ADR-027 — O módulo `llm` tem superfície pública declarada; import profundo é erro de build

**Status**: **aprovado pelo PI em 2026-07-27**. 2º pré-requisito da SPEC-032 (Fatia 21, issue #147). Depende do **ADR-026**, que já fixou o teto por tenant — por isso a porta deste módulo nasce recebendo `tenantId`, e não `userId`.

**Contexto**: acesso a LLM nasceu dentro do `insight`, e por dois anos de fatias isso não custou nada: só o `insight` chamava modelo. A porta `LlmClient` ficou em `insight/domain/`, o `LlmUsageRecorder` em `insight/application/`, a fábrica e os adapters em `insight/infrastructure/`. A Fatia 21 traz o segundo consumidor — o módulo `artifacts` — e o ADR-001 é explícito: *módulos se comunicam por interfaces públicas exportadas, nunca importando entidade interna de outro módulo*. `artifacts` importando `insight/domain/llm-client` seria violação direta e greppável.

**A armadilha desta extração é que mover o diretório não resolve o problema.** Um módulo `llm` novo, com os mesmos arquivos em `application/`, `domain/` e `infrastructure/`, e os consumidores importando `llm/domain/llm-client` e `llm/infrastructure/llm-client.factory`, **reproduz a violação no endereço novo**. O `exports` do `@Module` do Nest resolve a injeção de dependência — não resolve o import de TypeScript, que é onde o acoplamento mora. Sem uma superfície declarada, "módulo" vira nome de pasta.

**Decisão**:

1. **O módulo `llm` existe** e é dono de: a porta `LlmClient` (contrato `LlmRequest`/`LlmResponse`), os adapters por provedor (ADR-008), a fábrica que resolve o provedor ativo, o ledger `LlmUsage` (ADR-016) com a tarifação, e o **gate do teto** (ADR-026). O `insight` passa a ser **cliente** dele, como qualquer outro, e continua dono do que é dele: prompts, `input-hash`, orçamento de contexto.
2. **A superfície pública é um arquivo único e explícito** — `modules/llm/index.ts`. Nada fora do módulo importa de `llm/application/**`, `llm/domain/**` ou `llm/infrastructure/**`. Quem precisa de algo que não está no barril não improvisa um import profundo: **pede a exportação**, e a discussão sobre a fronteira acontece no PR, que é onde ela deve acontecer.
3. **A regra é verificada por máquina, não por revisão.** Import profundo em `modules/llm/**` a partir de fora **quebra o build**. Regra de fronteira que depende de alguém lembrar é regra que sobrevive até o primeiro PR apressado — mesma disciplina do teste que barra `closes #N` e da auditoria de RLS.

   > **O mecanismo é detalhe de implementação; a checagem automática não é.** A 1ª versão deste ADR pedia `no-restricted-imports` — e **o repo não usa ESLint**; a varredura estática em teste de arquitetura é o instrumento da casa (`tenant-scope.arch.spec.ts`). Corrigido em 2026-07-27, no mesmo dia, a partir do apontamento do Code no PR. Fica registrado porque ADR que nomeia ferramenta inexistente é o tipo de erro que vira cargo cult na próxima leitura.
4. **Refatoração pura: nenhuma rota muda, nenhum comportamento muda.** O `UsageController` continua em `usage/llm`; nenhum path de API é renomeado. Prova de que nada quebrou = **suíte do `insight` inteira verde sem alteração de asserção**. Teste que precisou mudar de expectativa é sinal de que a extração mudou comportamento — e aí não era refatoração.
5. **A direção da dependência é `llm → settings`, nunca o contrário.** O teto mora em `TenantSettings`, que é do `settings` (ADR-026); o `llm` lê por `capsOf(tenantId)`. Colocar as colunas de teto dentro do `llm` deixaria a configuração do usuário partida em dois lugares por um motivo de organização de código.

**Consequência**: `artifacts` (e qualquer módulo futuro) chama modelo sem tocar no `insight`, e a fronteira para de depender de disciplina — passa a depender do CI. Custo: um barril para manter e um PR de renomeação que toca muitos arquivos sem entregar nada visível ao usuário. É o preço combinado no ADR-001: *"a disciplina de fronteira é obrigatória — é ela que paga a extração futura"*. Esta é a extração futura; o preço está sendo pago agora, e barato, porque a disciplina existiu.

**Alternativas rejeitadas**:

- **Deixar no `insight` e o `artifacts` importar de lá.** Zero trabalho hoje. Rejeitado porque instala permanentemente a dependência `artifacts → insight` — dois módulos que não têm nada a ver um com o outro passariam a subir juntos, e a primeira mudança de prompt de resumo viraria risco de regressão no pipeline de cliente.
- **Mover os arquivos e confiar no `exports` do `@Module`.** É o meio do caminho, e é o mais perigoso dos três: dá a *aparência* de fronteira (o módulo existe, o `exports` está lá) enquanto os imports profundos continuam livres. Fronteira que aparenta existir é pior que fronteira ausente — ninguém audita o que já parece resolvido.
- **Extrair para pacote separado no monorepo (`packages/llm`).** Fronteira máxima, verificada pelo próprio resolvedor de módulos. Rejeitado por enquanto: o ADR-001 escolheu monolito modular, e pacote publicável traz build, versionamento e tsconfig próprios para resolver um problema que uma regra de lint resolve. Reavaliar se um dia o `llm` for consumido fora desta API.

## ADR-028 — O artefato de release vive em Release privada do GitHub, não no Postgres

**Status**: **aprovado pelo PI em 2026-07-29** (decisão 1 da SPEC-041), redigido pelo Code no PR-1 da Fatia 30 — mesmo caminho dos ADR-026/027. **Não emenda o ADR-025: é o gatilho dele disparando**, no cenário que ele mesmo pré-escreveu.

**Contexto**: o `war-room update` precisa que a máquina licenciada baixe o instalador da versão a que tem direito. O instalador tem **~80 MB**.

O ADR-025 decidiu que binário de cliente vive em `bytea` no Postgres, com teto de **10 MB por arquivo**, e listou cinco gatilhos de revisão. Um artefato de 80 MB dispara **dois** deles ao mesmo tempo: *"arquivo acima de 10 MB"* e *"segundo caso de uso de binário"*. Então esta fatia **não escolhe livremente** — ela chega num ponto que o ADR-025 já tinha marcado, e ele próprio escreveu o que fazer: *"disparado o gatilho, nasce ADR novo escolhendo object storage"*.

O que muda em relação ao caso do ADR-025 é o **dono do arquivo**. Lá, o binário é dado de cliente de um tenant — nasce de um upload no briefing público, não existe em nenhum outro lugar, e o critério que decidiu foi **isolamento**: perdê-lo de vista significaria vazamento entre tenants. Aqui, o binário é **produto do próprio vendedor**, ele já vive num repositório privado do GitHub que o vendedor administra, e o ProPlan nunca chega a possuí-lo.

**Decisão**:

1. **O artefato fica na Release privada do GitHub; o ProPlan guarda só o ponteiro** — `LicRelease` com `assetId`, `sha256`, `version`, `releasedAt`. Nenhum byte do instalador entra no Postgres, e **nenhum byte atravessa a API**: o `releases/download` devolve JSON com URL assinada, e há critério de aceite verificando isso no tráfego, não por afirmação.
2. **A tabela do ponteiro segue a regra de sempre**: `lic_releases` é raiz com `tenant_id`, `ENABLE`+`FORCE` RLS, como as demais `lic_*`. O ADR-020 continua valendo inteiro para os **metadados** — o que sai do Postgres é o binário, não o isolamento.
3. **A credencial é o `githubPat` do tenant** (SPEC-039), não uma exceção ao ADR-015. A emenda de 2026-07-30 da SPEC-041 retirou a exceção que a versão original pedia: o PAT já existe, é por tenant, cifrado, e aponta para o mesmo repo. Ler asset é subconjunto do que ele já faz ali.
4. **O artefato nunca é apagado** (decisão 3 do PI): licença perpétua com `updatesUntil` vencido continua baixando a última versão autorizada. Storage cresce monotonicamente — e cresce **na conta do GitHub do vendedor**, não na nossa.

**Consequência**: o ProPlan passa a depender da disponibilidade do GitHub para entregar update — se ele cair, `check` e `download` falham. Aceitável: o produto inteiro já depende do GitHub para ler documentação (ADR-003) e para o convite ao source (SPEC-039); esta fatia não acrescenta fornecedor, credencial nem linha na fatura. Em troca, 80 MB por versão ficam fora dos dumps do Postgres, e o vendedor publica release pelo fluxo que já usa.

**O que este ADR não decide**: o caso do ADR-025 continua como está. Anexo de briefing segue em `bytea`, com teto de 10 MB e RLS — os dois casos têm donos diferentes e critérios diferentes, e unificá-los agora seria trocar uma decisão que funciona por simetria.

**Alternativas rejeitadas**:

- **Subir o teto do ADR-025 e guardar os 80 MB em `bytea`.** Rejeitado pelo que o próprio ADR-025 previu: cada leitura carrega o arquivo inteiro em memória, `pg_dump` engorda 80 MB por versão publicada, e o artefato **nunca é apagado** (decisão 3) — o crescimento é monotônico por construção. Guardaríamos no banco mais caro uma cópia de um arquivo que já existe de graça no GitHub.
- **Ativar o Supabase Storage.** Tiraria o Supabase da reserva (ADR-022) e traria um segundo fornecedor ao caminho de dados para hospedar um arquivo que **já está hospedado**. O free tier que pausa após 7 dias sem request é especialmente ruim aqui: update é acesso esporádico por natureza.
- **Volume do Railway.** Prende a API a uma instância e cria um segundo procedimento de backup no `DEPLOY.md` — os mesmos motivos que o ADR-025 já usou para recusá-lo, agravados por o arquivo ser 8× maior.
- **Publicação automática pelo CI do War Room.** Fora de escopo por decisão do PI (SPEC-041 §Fora de escopo), não por este ADR: exigiria token de máquina com escrita administrativa dentro do módulo que guarda as licenças. Gatilho de revisão: passar de ~1 release por semana no piloto.
