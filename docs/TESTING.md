# TESTING.md — Estratégia de testes e relatório de evidência

> **Natureza deste documento.** Isto é **processo/infra de desenvolvimento**, não uma fatia
> de produto — logo **não é `SPEC-0XX`** (essa numeração é de produto). É a referência
> canônica de como testamos o repo e de como o **Claude Code** deve montar o CI e o relatório.
> Guia humano (estável, raramente editado) → pode viver em `docs/`. O **relatório gerado**
> (`reports/TESTS.md`) **não** vive em `docs/` — ver §4.

## 1. Princípio inegociável: evidência de máquina, nunca narrada

O ProPlan existe para detectar **fechamento frágil** — declarar "está tudo verde" sem prova real.
Aplicamos a mesma régua ao nosso próprio CI: **todo número de teste (quantidade, pass, falha,
cobertura) vem da saída `--json` do runner** (jest/vitest/playwright). Nenhum número é digitado
à mão nem narrado pelo agente. Um "410 testes verdes" escrito num markdown é uma *afirmação*;
o `jest-results.json` é *evidência*. Este documento existe para que a segunda coisa seja a única
que conta.

Consequência direta: o `reports/TESTS.md` é **gerado por script** e **verificado no CI** contra
uma execução limpa (guarda anti-drift, §5). Se alguém — humano ou agente — editar os números à
mão, o CI falha. É a versão da nossa própria filosofia aplicada ao nosso próprio processo.

## 2. Metodologia: pirâmide de testes e as 3 categorias

Usamos a **pirâmide de testes**: muita coisa barata e rápida na base, pouca coisa cara e lenta no
topo. As três categorias que você definiu (**Banco / Regras de Negócio / Tela**) mapeiam nas
camadas da pirâmide e em *o que cada teste prova*:

| Categoria | Camada | O que prova | Stack | Velocidade |
|---|---|---|---|---|
| **Regras de Negócio** | Unidade (base) | Lógica de domínio pura: uma função/regra faz o que deve, isolada de banco e rede | Jest, `apps/api/src/**/*.spec.ts` | rápida (ms) |
| **Banco** | Integração (meio) | Persistência e boundaries reais: repositórios contra Postgres via Prisma; API de ponta a ponta (HTTP → serviço → DB) | Jest + supertest, DB de teste | média (s) |
| **Tela** | Componente + E2E (topo) | UI: componente renderiza/reage certo (Vitest) e fluxo crítico funciona no browser (Playwright) | Vitest + Testing Library; Playwright | componente rápida / e2e lenta |

Notas de aprendizado (você pediu para melhorar o entendimento):

- **Clientes externos são mockados no boundary.** GitHub Contents/Trees API e Anthropic API
  **nunca** são chamados de verdade num teste. Isso casa com a regra de arquitetura "nunca chamar
  a Anthropic no caminho de render" — no teste, mock. Testa-se *o nosso código*, não a rede alheia.
- **Cobertura ≠ qualidade.** Cobertura mede *linhas executadas por algum teste*, não se o teste
  *verifica* algo útil. 100% de cobertura em getters triviais é teatro. Por isso o portão é
  **report-only** (§6): você olha a tendência, não persegue um número.
- **E2E não tem "cobertura de linha" que valha.** Playwright prova *comportamento*, não linhas.
  Na coluna Cobertura, "Tela" reflete o **Vitest** (componente); Playwright entra só com
  **contagem** (pass/falha). Isso é honesto, não uma lacuna.
- **O campo "Falha" será quase sempre 0** no momento da entrega — verde é o portão. O valor do
  registro está na **tendência de cobertura e no histórico por fatia**, não no pass/falha de um
  instante.

## 3. Organização dos testes (convenção, sem hardcode)

A classificação teste→categoria é **determinística por diretório/sufixo** — o script não adivinha.

**`apps/api` (Jest projects):**

- `regras` → `src/**/*.spec.ts` — unidade, sem DB, sem rede.
- `banco`  → `src/**/*.int-spec.ts` (integração com Prisma) **+** `test/**/*.e2e-spec.ts` (e2e da API).

**`apps/web`:**

- Componente → Vitest + Testing Library: `src/**/*.test.tsx`.
- E2E → Playwright: `e2e/**/*.spec.ts`.

O mapeamento categoria→diretório mora em **`test-report.config.json`** (raiz), não no código do
gerador — assim o mesmo tooling cai em outro projeto só ajustando o mapa (reutilização, §7). Isto
segue a regra "sem hardcode": a convenção é dado, não constante embutida.

## 4. O relatório: `reports/TESTS.md`

**Local:** `reports/` na raiz — **novo diretório neutro**. Não vai em `docs/` (um arquivo
reescrito a cada entrega por máquina zeraria o relógio do alerta de doc defasada — ADR-010 — e
mascararia docs humanas velhas). Não vai em `.proplan/` (lá é artefato do *produto* ProPlan em
repos-alvo; misturaria semântica).

**Cabeçalho obrigatório do arquivo:**

```
<!-- GERADO AUTOMATICAMENTE por scripts/gen-test-report.ts — NÃO EDITAR À MÃO.
     Fonte dos números: jest/vitest/playwright --json. Divergência é barrada no CI. -->
```

**Formato — tabela-registro (append por entrega).** Cada entrega adiciona **3 linhas** (uma por
categoria) compartilhando Data/Issue/SPEC/PR. A categoria **é** o "tipo de teste realizado":

| Data | Issue | SPEC | Categoria | Testes | Pass | Falha | Cobertura % | PR | Link PR |
|------|-------|------|-----------|-------:|-----:|------:|------------:|----:|--------|
| 2026-07-15 | #12 | SPEC-014 | Regras de Negócio | 128 | 128 | 0 | 91.2 | #45 | link Github pr |
| 2026-07-15 | #12 | SPEC-014 | Banco             | 34  | 34  | 0 | 78.0 | #45 | link Github pr |
| 2026-07-15 | #12 | SPEC-014 | Tela              | 22  | 22  | 0 | 64.5* | #45 | link Github pr |

`*` cobertura de Tela = Vitest (componente); a parte Playwright entra só na contagem.

O histórico é **append-only** (linhas de entregas passadas são imutáveis). Uma seção no topo,
`## Estado atual`, mostra os totais da última execução — regenerada, não acumulada.

## 5. Fluxo de geração (fim de entrega) + guarda anti-drift

**Quem gera:** o **Claude Code**, no fim da fatia (junto do commit de docs da entrega), roda
`pnpm test:report`. O script:

1. Executa os runners com `--json` (ou lê os artefatos `*-results.json` + `coverage-summary.json`).
2. Classifica por categoria via `test-report.config.json`.
3. **Acrescenta** as linhas da entrega ao histórico de `reports/TESTS.md` com os números reais. Linha commitada **nunca** é reescrita nem removida — reentregar a mesma issue vira uma linha nova, datada (duas execuções são dois fatos).
4. Regenera a seção `## Estado atual`.

> **Corrigido em 2026-07-16.** O item 3 dizia *"**upsert** das linhas da issue atual"* — contradizendo o append-only do §4 duas seções acima. O código seguiu o upsert e o append-only virou só texto. Pior: o gerador **descartava o histórico inteiro** quando rodava sem `refs #N` (o caso de `pnpm test:report` local, antes do PR) — foi assim que o registro da SPEC-016 sumiu, recuperado depois do commit `5a3fea4`. Hoje: **sem issue preserva e não acrescenta** (uma linha `| — | — | — |` não é evidência de entrega); **com issue, acrescenta**.

> **Como carimbar a entrega (o comando que o Code roda).** Os metadados da linha vêm de
> variáveis de ambiente — o CI as extrai do corpo do PR, mas numa execução **local** elas não
> existem, e sem elas o gerador (corretamente) só atualiza o `Estado atual`. Para deixar a linha
> no histórico, rode na raiz do repo:
>
> ```bash
> REPORT_ISSUE=#103 REPORT_SPEC=SPEC-027 REPORT_PR=#104 pnpm test:report
> ```
>
> `REPORT_DATE` e `REPORT_PR_URL` são opcionais (a data cai para hoje; o link é montado do
> `repoUrl` do config). **Esquecer isso não é mais silencioso** — ver a prova 3 abaixo.

**Guarda anti-drift (o que torna o arquivo confiável):** no PR, o CI roda o gerador em
**`--check`**, que faz **três provas independentes** — são três formas distintas de a evidência
mentir:

1. **Números** — recomputa os totais numa execução limpa e compara com a seção `## Estado atual`
   commitada. Divergiu → **CI falha**. O número só "cola" se sobreviver a uma reexecução
   independente. Compara só os números, não os rótulos Data/Issue/PR (que variam por PR de
   propósito).
2. **Histórico (append-only)** — prova que **toda linha da baseline continua no arquivo**.
   Append-only é verificável por **continência de conjunto**, não por igualdade: o histórico novo
   pode ter linhas a mais (a entrega atual), nunca a menos. Por isso não sofre do problema dos
   metadados que motivou o recorte da prova 1.
3. **Carimbo da entrega** (`--require-entry`, desde 2026-07-22) — prova que a entrega **deixou
   linha** no histórico. Só é exigida de PR que **altera arquivo de teste** (PR só de `docs/` não
   é barrado) e compara pela issue do `refs #N`. Sem linha → **CI falha**, com o comando exato a
   rodar na mensagem.

> **Por que a prova 3 nasceu (achado do PI em 2026-07-22).** As provas 1 e 2 cobrem *número
> forjado* e *histórico apagado* — nenhuma cobre **histórico que nunca foi escrito**. As entregas
> da **SPEC-027** (#103) e da **SPEC-022** (#106, #109) mergearam com CI verde e **nenhuma linha**
> no histórico: o Code rodou `pnpm test:report` local, sem as env vars, e o gerador — como manda o
> §4 — atualizou só o `Estado atual`. Olhando a tabela, parecia que aquelas entregas **não tiveram
> teste**, quando havia 671 testes verdes. É a falha mais insidiosa deste arquivo: não um número
> errado, mas um **silêncio que se lê como ausência**. O gerador não tinha bug — faltava a trava.
>
> **Por que o CI não passou a commitar a linha** (alternativa levantada e rejeitada pelo PI): o
> `--check` **não reescreve** o arquivo de propósito — se reescrevesse, um número editado à mão
> seria silenciosamente sobrescrito em vez de barrado, e a prova 1 morreria. Guarda que corrige
> não é guarda. Então o CI **barra**, e quem carimba continua sendo quem entrega.

> **Corrigido em 2026-07-16 (a guarda não guardava).** A prova 2 não existia: o `--check` olhava
> só os números. O bug que apagou o registro da SPEC-016 passou por **CI verde em 3 PRs seguidos**
> — os totais do `Estado atual` estavam certos enquanto o histórico era zerado. A guarda que
> existe para impedir evidência forjada não via a evidência acumulada. Dois aprendizados que o
> conserto rendeu, ambos registrados no código:
>
> - **A baseline não pode sair do arquivo auditado.** A 1ª tentativa comparava o arquivo com a
>   saída do gerador — que é construída *a partir* do arquivo. Histórico apagado ⇒ os dois lados
>   vinham vazios ⇒ "íntegro": o arquivo corrompido testemunhando a própria integridade. A
>   baseline é o **blob do git na base do PR** (`REPORT_BASE_REF`), nunca `HEAD` — no CI de PR
>   HEAD é o merge commit, cujo `TESTS.md` é a versão do próprio PR (o mesmo auto-testemunho).
> - **A prova de números estava falhando aberta.** Num checkout Windows o arquivo chega com CRLF
>   e o gerador emite LF: o `--check` acusava divergência entre blocos idênticos. Um guard que
>   falha sempre é um guard que ninguém lê — falhar com número certo é o mesmo que não falhar com
>   número errado. Comparação normaliza a quebra de linha.

**Quem guarda a guarda:** `scripts/gen-test-report.selfcheck.ts` (`pnpm test:report:selfcheck`,
roda no CI antes do `--check`) prova o próprio gerador — append puro, histórico zerado, upsert de
linha commitada, CRLF. Sem isso, um bug no gerador desliga a guarda em silêncio, que foi
exatamente o que aconteceu. É `assert` puro do Node, sem framework: o jest da API tem
`rootDir: apps/api` e não alcança `scripts/`. Onde o teste de script deve morar em definitivo
(project novo no `jest.config.js` vs runner na raiz) segue como decisão em aberto no `STATUS.md`.

## 6. Workflow de CI — `.github/workflows/ci.yml`

Dispara em **todo pull request**. Job único `test` (ou dois jobs em paralelo: `api` e `web`):

- **Services:** `postgres` (DB de teste) e `redis` (só se algum teste de integração usar BullMQ
  real; senão, mock e dispensa).
- **Passos:**
  1. `pnpm install`.
  2. **api:** `prisma migrate deploy` no DB de teste → `jest --coverage --json` (projects `regras` e `banco`).
  3. **web:** `vitest run --coverage` → `playwright install --with-deps` → `playwright test --reporter=json`.
  4. `pnpm test:report` → escreve a tabela em **`$GITHUB_STEP_SUMMARY`** (aparece na aba do run) **e** publica/atualiza um **comentário fixo no PR** (sticky comment).
  5. `pnpm test:report --check` → **falha se `reports/TESTS.md` divergir** de uma execução limpa.
- **Cobertura:** **report-only** — publica os números, **não barra o merge**. (Subir para portão
  com limiar fica para depois, quando houver baseline e mais confiança.)

Nada disso usa `closes #N` nem toca em aceite — é comentário informativo. O aceite continua sendo
ato deliberado do PI (ADR-011); o CI só torna a *evidência* impossível de falsificar.

## 7. Reutilização em projetos futuros

O objetivo é ter isto "de fábrica" nos próximos projetos.

> **Passo a passo completo: [`PORTAR-TESTS-REPORT.md`](PORTAR-TESTS-REPORT.md)** — o que copiar,
> o que adaptar, o trecho do workflow pronto e as **cinco armadilhas** que custaram CI verde
> mentindo (2026-07-22).

Os artefatos:

| Arquivo | Porte |
|---|---|
| `scripts/gen-test-report.ts` | **copia** — repo-agnóstico, lê tudo do config |
| `scripts/gen-test-report.selfcheck.ts` | **copia** — quem guarda a guarda |
| `scripts/test-report.mjs` | **copia e ajusta** — os diretórios dos apps e os comandos dos runners estão **fixos no código** |
| `test-report.config.json` | **reescreve** — o mapa categoria→JSON |
| `.github/workflows/ci.yml` | **adapta** — os 4 passos das guardas |
| convenções de sufixo | `*.spec.ts` / `*.int-spec.ts` / `*.e2e-spec.ts` / `*.test.tsx` / `*.selfcheck.ts` |

> **Correção de 2026-07-22.** Esta seção dizia *"copiar os três primeiros e ajustar o config"* e
> omitia o `test-report.mjs` — que **não** é agnóstico, apesar de o comentário do config afirmar
> que ele é *"o único arquivo que muda por projeto"*. Quem seguisse a receita ao pé da letra
> teria um orquestrador procurando `apps/api` num repo sem essa pasta.

## 8. Critérios de aceite (verificáveis pelo PI)

Para o Code implementar e o PI conferir:

- [ ] CI roda em todo PR e publica a tabela no **job summary** e em **comentário fixo do PR**.
- [ ] Todos os números vêm de `--json` dos runners; **zero** número escrito à mão.
- [ ] `reports/TESTS.md` existe, tem o cabeçalho "GERADO — NÃO EDITAR", e traz 3 linhas
      (Banco/Regras/Tela) por entrega + seção `## Estado atual`.
- [ ] `pnpm test:report --check` **falha** o CI quando a linha da issue atual não bate com uma
      execução limpa (anti-forja comprovado ao vivo).
- [x] `--check` **falha** quando uma linha já registrada some do histórico (append-only), tendo o
      blob da base do PR como baseline — nunca o próprio arquivo. *Comprovado ao vivo em
      2026-07-16: forja do bug da SPEC-016 (histórico apagado, números certos) → exit 1 nomeando
      as 3 linhas perdidas; append legítimo e arquivo intacto → exit 0.*
- [x] O gerador tem self-check próprio no CI (`pnpm test:report:selfcheck`), incluindo o caso
      CRLF — um bug no gerador não pode desligar a guarda em silêncio.
- [ ] Cobertura é **reportada**, não barra merge.
- [ ] `apps/web` passa a ter **Vitest + Testing Library** e **Playwright** configurados; a
      categoria "Tela" deixa de ficar vazia.
- [ ] `reports/TESTS.md` **não** está sob `docs/`; o alerta de doc defasada (ADR-010) segue medindo
      só conteúdo humano.
- [ ] Registrar a decisão como **ADR** em `docs/DECISIONS.md` (relatório de testes é gerado pelo
      CI, arquivo-registro incremental, categorias Banco/Regras/Tela, guarda anti-drift).

## 8.1. O que o botão *"Testar Webhook"* da Kiwify testa — e o que não testa

> Registrado por exigência da **SPEC-045**, a partir do dogfooding de 2026-08-04
> (issue [#257](https://github.com/RodReis/rrb-proplan/issues/257)). Vale para
> qualquer disparo manual de webhook a partir do painel da plataforma.

**O que ele exercita — e é real:**

- **Intake.** A entrega chega, a rota responde e o `LicWebhookEvent` é gravado
  com o payload bruto.
- **Assinatura.** Foi ele que provou, na sessão de 2026-08-04, que o `401` tinha
  acabado depois do acerto do Token no painel da Kiwify. Para essa pergunta —
  *"o segredo está certo?"* — ele é a ferramenta certa e mais rápida.

**O que ele NÃO exercita:**

- **O fluxo completo.** Cada disparo manda um `product_id` **fictício e
  diferente** a cada vez (`38316019`, `d972678b`, …). Nenhum corresponde a
  produto real, então nenhum resolve mapeamento, emite licença ou dispara
  e-mail. O evento **sempre** termina em `FAILED` com *"oferta sem mapeamento"* —
  e isso é o comportamento correto, não um defeito.
  > **Emenda de 2026-08-04** (commit `cfba2cf`): `764cd7eb` **não** era id de
  > teste — era **venda real**, `PROCESSED`, com licença emitida e mapeada como
  > *"Sem código Fonte"*. Estava nesta lista por semelhança de formato, herdada
  > do corpo original de #257 e propagada sem conferência contra o banco.
  > **Descartar por semelhança de id é exatamente o modo de errar que a SPEC-045
  > cria** — o motivo obrigatório existe para forçar a conferência antes.
- **Portanto: ele não substitui o dogfooding com venda real.** As fatias que
  dependem de emissão de ponta a ponta continuam pendentes desse teste.

**O custo, que é a parte fácil de esquecer:** cada disparo cria uma pendência
permanente. Como o `product_id` é diferente a cada vez, seis disparos viraram
seis ofertas distintas na aba *Oferta → edição* — badge laranja sem conserto,
porque mapear emitiria licença real para venda que não existe.

**A saída é o descarte** (SPEC-045), não `DELETE` no banco: a linha e o payload
continuam consultáveis no filtro `Descartadas`, com autor e motivo. **Cada teste
futuro custa um descarte** — dívida aceita pelo PI (decisão #4), porque
reconhecer o evento de teste no intake exigiria heurística sobre o payload, e
heurística que engole venda real é pior que uma lista suja.

## 8.2. `PROCESSED` sem de-para: por que a lista continua mostrando

> Registrado pela **SPEC-046** (issue
> [#259](https://github.com/RodReis/rrb-proplan/issues/259)), a partir do
> dogfooding em produção da SPEC-045.

Descartadas as entregas de teste da §8.1, o badge de Pendências ficou limpo — e a
aba *Oferta → edição* **continuou** marcando três ofertas. As três eram
`PROCESSED` **com licença emitida**, e mesmo assim sem `LicOfferMapping`.

**Não é defeito, e há três caminhos legítimos para chegar lá:**

1. **Curto-circuito por `saleRef`.** `emitir()` procura licença com o mesmo
   `saleRef` **antes** de `resolverEdicao()`; achando, sai. É a guarda
   anti-emissão-dupla. Licença emitida à mão com o `saleRef` da venda ⇒ a
   entrega processa **sem nunca olhar o mapeamento**.
2. **Evento que não é compra.** `revoke`, `renew`, `past_due` e `cancel`
   resolvem por `encontrar()` (`saleRef` → assinatura → e-mail) e **nunca**
   tocam no de-para.
3. **De-para removido depois** de a entrega ter processado — e este **não deixa
   rastro nenhum**.

**Como conferir qual é o caso:** não dá, e a SPEC-046 decidiu não tentar
(decisão PI #2). O que a tela afirma é a **consequência**, verdadeira nos três:
*não há de-para hoje, logo a próxima compra por webhook deste produto vai
falhar*. Por isso a oferta aparece no bloco **neutro** — fora do badge, mas
visível: escondê-la faria a próxima venda falhar sem aviso.

**Ao testar a aba:** oferta com pelo menos uma entrega `PENDING`/`FAILED` é
*venda parada agora* e conta no badge; oferta com todas `PROCESSED`/`IGNORED` é
*sem de-para, nada parado*, em tom neutro. Uma oferta **nunca** sai nos dois
blocos. Mapear funciona em ambos e cria o mesmo `LicOfferMapping` — no bloco
neutro o efeito é sobre **vendas futuras**, e o toast não sugere reprocessar.

## 9. Decisões operacionais (resolvidas pelo PI em 2026-07-15)

- **Comando:** `pnpm test:report`.
- **Playwright no CI:** roda **sempre**, em **job separado**, enquanto a suíte for pequena.
  Reavaliar (label/condicional) se o tempo de CI incomodar.
- **Redis no CI:** só sobe **se** algum teste de integração exercitar BullMQ de verdade;
  caso contrário BullMQ é mockado no boundary e o serviço Redis não entra no workflow.

Governadas pelo **ADR-019** (`docs/DECISIONS.md`).
