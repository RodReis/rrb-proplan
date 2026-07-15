---
proplan: v1
spec: SPEC-019
fatia: 14
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-15 (escopo + 4 decisões do PI incorporadas)
updated: 2026-07-15
---
# SPEC-019 — Fatia 14: Portfólio da fábrica + Radar de risco

> **A tela inicial diária.** Com 6–20 repos gerenciados (decisão do PI, 2026-07-15), o dono não lembra o estado de cada um de cabeça. O portfólio é o ponto de entrada: uma leitura cross-projeto de *quais estão parados, com CI vermelho, com doc apodrecida*. O radar agrega esses sinais num ranking de atenção. **Consequência das fatias anteriores** (MVP2 §7): o dado já existe — esta fatia o mostra junto.

## O que já existe e o que é novo (a base honesta do escopo)

O portfólio e o radar **não inventam sinal** — projetam o que as fatias entregues já calculam. É o que torna esta fatia madura apesar de o núcleo 10/11 não estar pronto:

| sinal de risco | fonte | estado |
|---|---|---|
| **staleness** (doc mais velha que o código) | `Project.lastCodeCommitAt/lastDocsCommitAt` (ADR-010) | **entregue** |
| **cobertura/confiança** (entidades ausentes/defasadas) | `CanonicalField` (Fatia 9) | **entregue** |
| **deploy** (doc × realidade discordam / omissão) | `Project.deployVerdict/deploySignals` (Fatia 13) | **entregue** |
| **CI vermelho** (último workflow run falhou) | Actions API do GitHub | **novo — esta fatia** |
| ~~constraints `a-revalidar`~~ (path citado mudou) | asserção humana (Fatia 10) | **slot peso-zero** (acende quando a 10 entregar) |
| ~~blockers~~ (frente travada por decisão ausente) | `find_blockers` (Fatia 11) | **slot peso-zero** (acende quando a 11 entregar) |

**Decisão de desenho contra retrabalho**: o radar nasce **extensível** — mesmo padrão da Fatia 9 (contradição/drift como slots de peso zero) e da 13.5 (bloco recusa honestamente até a fonte existir). Os dois slots de 10/11 são **declarados, não calculados**; quando a fatia entregar, viram input sem reescrever o radar.

## Objetivo

Uma view cross-projeto (**Portfólio**) sobre os repos **gerenciados**, cada linha mostrando os sinais de risco **crus e datados** — nunca um score de saúde opaco (ADR-012). Sobre ela, um **Radar** que ordena por atenção segundo uma **regra transparente**. Zero IA no caminho (ADR-002): tudo é projeção determinística do que já está persistido + o fato de CI lido do GitHub.

## A linha que este produto não cruza: nada de "health score" (ADR-012 / tese)

A tentação óbvia do portfólio é um número por projeto (`saúde: 62%`). **Proibido pela mesma razão do ADR-012**: um composto é um roll-up opaco — some a conta, e "62%" não diz *o quê* está podre. A tese do MVP2 é o oposto: **mostrar a conta, recusar quando não sabe**. Logo:

- A linha do portfólio mostra os sinais **lado a lado, cada um datado e clicável** — `staleness 42d · cobertura 9/13 · deploy: discordam (4d) · CI: falhou (2h)` — não um número que os funde.
- O radar **ordena** por uma regra determinística e auditável (ver PA-1), nunca por um score inventado.

## Escopo

1. **View Portfólio** — nova tela **top-level** (não dentro de um workspace de projeto; ver PA-4), lista os repos **gerenciados** (não os 22 do catálogo — só os `managed`). Cada linha: nome + os 4 sinais entregues (staleness, cobertura, deploy, CI), cada um **datado**, clicável, abrindo o projeto/aba correspondente. Densidade pensada para 6–20 linhas.
2. **Coleta de CI** (nova) — no sync, coletar o **`conclusion` + data do último workflow run** por repo (Actions API do GitHub). Persistido como cache derivado no `Project` (`ciStatus`, `ciObservedAt`), **tolerante a falha** (repo sem Actions → `sem-ci`, não erro). Exige `Actions: read` no GitHub App (ADR-015 — mesma mecânica do `Deployments: read` da Fatia 13).
3. **Radar de risco** — agrega, por projeto, os 4 sinais entregues num **read de risco** (quantos sinais em vermelho, qual o pior), e **ordena o portfólio** por atenção (regra transparente, PA-1). **Slots peso-zero** declarados para constraints-`a-revalidar` (Fatia 10) e blockers (Fatia 11): não entram na conta hoje, acendem quando a fatia existir.
4. **Projeção de leitura pura** (`portfolio/domain/`) — monta as linhas e o ranking a partir do que já está persistido; sem IA (ADR-002), determinística (mesmo estado do banco → mesma ordem).
5. **Fronteira ADR-017 no CI** — o CI é **fato vivo do GitHub**. A **UI pode ler o cache** (assimetria explícita do ADR-017: o humano vê o botão Sincronizar e sabe que é foto); o **MCP nunca serve CI como fato** (ver Fora de escopo). Todo sinal de CI na tela é **datado** (`lido há 2h`) e **linka para o GitHub Actions** — nunca apresentado como verdade fresca.

## Fora de escopo (explícito)

- **As outras views** — timeline, mapa de confiança, matriz de prontidão (MVP2 §7). Ficam para fatia própria; dependem mais dos sinais de 10/11. Esta fatia é **portfólio + radar**, nada além.
- **Score de saúde composto por projeto** — proibido (ADR-012 / seção acima). Sinais crus lado a lado, sempre.
- **Servir portfólio/radar/CI pelo MCP** (Fatia 11) — o MCP entrega julgamento por-projeto com evidência; agregação cross-projeto para consumo de agente, se um dia fizer sentido, é fatia própria. E **CI nunca** vira fato servido pelo MCP (ADR-017 — o agente age sobre o que recebe; CI defasado com cara de autoridade é a pior classe de bug).
- **Qualquer IA** no caminho de render/coleta (ADR-002/ADR-016).
- **Sinais de 10/11 calculados agora** — são slots declarados; calculá-los é a fatia que entregar 10/11, não esta.
- **Ordenação manual / drag do portfólio** — o valor é o ranking automático por risco; reordenar à mão é GitHub-Projects-v2-território (backlog, prio baixa).

## Contratos

- **Prisma**: `Project` ganha `ciStatus String?` (`success | failure | sem-ci | ...`), `ciConclusionUrl String?` (link do run), `ciObservedAt DateTime?` — cache derivado, reconstruível no sync (padrão do `deployVerdict` da Fatia 13). **Nenhuma tabela nova** — portfólio e radar são projeção sobre `Project` + `CanonicalField` existentes.
- **Coleta**: passo no `sync-job` (após deploy-drift da 13), tolerante a falha, versionado por `ciObservedAt`. Usa o client `fetch` existente (Octokit é ESM-only — CLAUDE.md; não reintroduzir).
- **GitHub App** (ADR-015): adicionar `Actions: read` ao conjunto de permissões (leitura de workflow runs). Leitura segue com **user-to-server token** (respeita a visibilidade do dono).
- **Domínio puro e testável** (`portfolio/domain/`): `assemblePortfolio(projects, canonical, ci): PortfolioRow[]` (projeção) e `rankByRisk(rows): PortfolioRow[]` (ordenação determinística, regra da PA-1). Radar = a mesma estrutura com o ranking aplicado; slots de 10/11 entram como campos opcionais somados com peso zero (extensível sem reescrita).
- **API**: `GET /portfolio` → as linhas + a ordem. Cross-projeto; lê do banco, **sem IA** (verificável: não cria `LlmUsage`). Consome `catalog`/`canonical` por interface pública (ADR-001), não importa entidade interna.
- **UI**: nova entrada top-level "Portfólio" (ver PA-4). Linha = chips de sinal datados e clicáveis; a confiança de cada chip reusa o padrão clicável da Fatia 9 (mostra a conta).

## Critérios de aceite

- [ ] O portfólio lista **só repos gerenciados**, cada linha com os 4 sinais entregues, **cada um datado e clicável** — **nenhum** score de saúde composto (revisão contra ADR-012 é critério).
- [ ] CI: o último workflow run é coletado no sync (tolerante a falha; repo sem Actions → `sem-ci`), **datado na tela** e linkando para o GitHub; a UI o lê do cache, o MCP **não** o serve (teste/revisão contra ADR-017).
- [ ] O radar **ordena por uma regra determinística e auditável** (PA-1); rodar 2× sobre o mesmo estado do banco → mesma ordem (fixture, não "avaliação").
- [ ] Os sinais de 10/11 são **slots peso-zero**: um teste prova que hoje não entram na conta e que o radar não quebra na ausência deles.
- [ ] Zero IA no caminho de `/portfolio` e da coleta de CI (não cria `LlmUsage`).
- [ ] `ciStatus/ciObservedAt` são **reconstruíveis** por re-sync (padrão do `deployVerdict`, ADR-014).
- [ ] `Actions: read` adicionado ao GitHub App; leitura com user-to-server token (ADR-015).
- [ ] `portfolio/domain` não importa entidade interna de `catalog`/`canonical` — interface pública (ADR-001).

## Notas técnicas

- **Por que o portfólio é maduro apesar de 10/11 não estarem prontos**: seus 3 sinais principais (staleness, cobertura, deploy) já são calculados e persistidos; o 4º (CI) é uma leitura de GitHub barata e cacheável. Os sinais que faltam (10/11) **enriquecem**, não são pré-requisito — daí os slots.
- **CI e o ADR-017**: coletar workflow-run status é a mesma classe de leitura que os Deployments da Fatia 13 (fato do GitHub, cacheado, mostrado na UI datado). O que **muda** em relação ao deploy é só a permissão (`Actions: read`). A regra dura permanece: **cache é ótimo para renderizar, péssimo para servir a quem age** — por isso fica fora do MCP.
- **Radar extensível**: `rankByRisk` soma sinais com peso; os slots de 10/11 entram com peso zero até a fatia que os calcula subir o peso. Nenhuma reescrita — só um peso que deixa de ser zero.
- **Dogfooding**: com os `rrb-*` reais (`rrb-escola` deploy discordante, `rrb-organize` só-github-side, `rrb-adv` sem deploy, `construtor-erp` sem deploy) o portfólio já nasce com casos ricos — o mesmo material que validou a Fatia 13.

## Decisões do PI (2026-07-15) — nenhuma pergunta aberta

1. **Ordenação do radar: contagem de sinais em vermelho, desempate por staleness.** Transparente ("3 sinais em alerta"), auditável, sem número que funde. **"Vermelho" por sinal:** staleness > limiar do ADR-010 · cobertura < limiar da Fatia 9 · deploy ∈ {discordam, só-github-side} · CI = failure/timed_out/cancelled (Decisão 2).
2. **"CI vermelho" = `failure`/`timed_out`/`cancelled`; `sem-ci` e `sem-run` = neutro.** Ausência de CI não é falha de CI — mesma lógica do "não documentado" da Fatia 13: não inventa problema, não gera falso-positivo.
3. **Slots de 10/11 declarados já, peso zero** — invisíveis na UI até terem valor; quando 10/11 entregarem, viram input sem reescrever o radar. É o desenho anti-retrabalho que sustenta incluir o radar nesta fatia.
4. **Portfólio = nova entrada top-level agora**, separada do catálogo. Se com 6–20 repos virar o uso diário, promover a home numa fatia de UX posterior — a home **não** é cravada aqui.
