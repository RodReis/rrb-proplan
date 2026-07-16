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
3. **Upsert** das linhas da issue atual em `reports/TESTS.md` com os números reais.
4. Regenera a seção `## Estado atual`.

**Guarda anti-drift (o que torna o arquivo confiável):** no PR, o CI roda o gerador em
**`--check`**: recomputa os números da issue atual numa execução limpa e compara com as linhas
commitadas. Divergiu → **CI falha**. É isso que impede forjar o relatório: o número só "cola" se
sobreviver a uma reexecução independente. Linhas de entregas passadas não são recomputadas (são
histórico).

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

O objetivo é ter isto "de fábrica" nos próximos projetos. Os artefatos portáveis são:

- `.github/workflows/ci.yml`
- `scripts/gen-test-report.ts` (repo-agnóstico — lê tudo do config)
- `test-report.config.json` (o mapa categoria→diretório; **o único arquivo que muda por projeto**)
- as convenções de sufixo (`*.spec.ts` / `*.int-spec.ts` / `*.e2e-spec.ts` / `*.test.tsx`)

Cair num projeto novo = copiar os três primeiros, ajustar o config, criar `reports/`.

## 8. Critérios de aceite (verificáveis pelo PI)

Para o Code implementar e o PI conferir:

- [ ] CI roda em todo PR e publica a tabela no **job summary** e em **comentário fixo do PR**.
- [ ] Todos os números vêm de `--json` dos runners; **zero** número escrito à mão.
- [ ] `reports/TESTS.md` existe, tem o cabeçalho "GERADO — NÃO EDITAR", e traz 3 linhas
      (Banco/Regras/Tela) por entrega + seção `## Estado atual`.
- [ ] `pnpm test:report --check` **falha** o CI quando a linha da issue atual não bate com uma
      execução limpa (anti-forja comprovado ao vivo).
- [ ] Cobertura é **reportada**, não barra merge.
- [ ] `apps/web` passa a ter **Vitest + Testing Library** e **Playwright** configurados; a
      categoria "Tela" deixa de ficar vazia.
- [ ] `reports/TESTS.md` **não** está sob `docs/`; o alerta de doc defasada (ADR-010) segue medindo
      só conteúdo humano.
- [ ] Registrar a decisão como **ADR** em `docs/DECISIONS.md` (relatório de testes é gerado pelo
      CI, arquivo-registro incremental, categorias Banco/Regras/Tela, guarda anti-drift).

## 9. Decisões operacionais (resolvidas pelo PI em 2026-07-15)

- **Comando:** `pnpm test:report`.
- **Playwright no CI:** roda **sempre**, em **job separado**, enquanto a suíte for pequena.
  Reavaliar (label/condicional) se o tempo de CI incomodar.
- **Redis no CI:** só sobe **se** algum teste de integração exercitar BullMQ de verdade;
  caso contrário BullMQ é mockado no boundary e o serviço Redis não entra no workflow.

Governadas pelo **ADR-019** (`docs/DECISIONS.md`).
