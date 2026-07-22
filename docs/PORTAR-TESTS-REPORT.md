# Portar o relatório de testes para outro projeto

Como levar o mecanismo do ADR-019 — **evidência de teste gerada por máquina e
verificada, nunca narrada** — para outro repositório.

O **gerador** é repo-agnóstico: lê tudo do `test-report.config.json`. O
**orquestrador** não é — tem os caminhos dos apps fixos no código, apesar de o
comentário do config sugerir o contrário. São ~15 min de porte, não 5.

---

## 1. Copiar sem alterar

```
scripts/gen-test-report.ts            # gerador + as 3 guardas
scripts/gen-test-report.selfcheck.ts  # 17 checks que provam o gerador
```

Esses dois são de fato repo-agnósticos: leem tudo do config e não citam o
projeto.

## 2. Copiar E adaptar: `scripts/test-report.mjs`

⚠️ **O orquestrador NÃO é agnóstico** (apesar do que o config sugere). Ele tem
os caminhos e comandos **fixos no código**:

```js
const api = resolve(ROOT, 'apps/api');   // ajuste
const web = resolve(ROOT, 'apps/web');   // ajuste
run('npx', ['jest', '--selectProjects', 'regras', …], api);   // ajuste
run('npx', ['vitest', 'run', …], web);                        // ajuste
```

Edite o bloco `if (!noRun) { … }` para os diretórios e runners do outro projeto.
O resto do arquivo (repasse de flags, exit code) copia inalterado.

## 3. Adaptar: `test-report.config.json`

Diz ao **gerador** onde achar os JSONs que o orquestrador produziu. Os dois
precisam concordar nos caminhos.

```jsonc
{
  "reportPath": "reports/TESTS.md",
  "repoUrl": "https://github.com/OWNER/REPO",   // monta o link do PR
  "categories": [
    {
      "name": "Regras de Negócio",              // rótulo livre
      "runner": "jest",                          // rótulo documental: ninguém lê
      "project": "regras",                       // --selectProjects do jest
      "resultsJson": "reports/.raw/api-regras.json",
      "coverageSummary": "apps/api/coverage/regras/coverage-summary.json"
    }
  ]
}
```

Quantas categorias quiser — uma só já funciona. `coverageSummary` é opcional
(sem ele a coluna fica `—`).

## 4. Scripts no `package.json` da raiz

```json
"test:report": "node scripts/test-report.mjs",
"test:report:check": "node scripts/test-report.mjs --check",
"test:report:selfcheck": "node scripts/test-report.mjs --selfcheck"
```

## 5. Workflow — os passos que importam

No job de PR, **nesta ordem**:

```yaml
    env:
      REPORT_PR: "#${{ github.event.pull_request.number }}"
      REPORT_PR_URL: ${{ github.event.pull_request.html_url }}
    steps:
      - uses: actions/checkout@v4

      # Metadados da linha. Via env, NUNCA interpolado no run: corpo e título
      # de PR são texto de usuário, e ${{ }} direto no shell é injeção.
      - name: Metadados da entrega
        env:
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_UPDATED_AT: ${{ github.event.pull_request.updated_at }}
        run: |
          issue=$(printf '%s' "$PR_BODY" | grep -oiE 'refs #[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
          spec=$(printf '%s' "$PR_TITLE" | grep -oiE '\[SPEC-[0-9]{3}\]' | head -1 | grep -oiE 'SPEC-[0-9]{3}' || true)
          echo "REPORT_ISSUE=${issue:+#$issue}" >> "$GITHUB_ENV"
          echo "REPORT_SPEC=${spec:-}" >> "$GITHUB_ENV"
          echo "REPORT_DATE=$(date -u -d "$PR_UPDATED_AT" +%Y-%m-%d)" >> "$GITHUB_ENV"

      # Baseline do append-only. Sem isto a guarda 2 não tem contra o que comparar.
      - name: Buscar a base do PR
        if: github.event_name == 'pull_request'
        run: git fetch --depth=1 origin "${{ github.base_ref }}"

      - name: Self-check do gerador
        run: pnpm test:report:selfcheck

      # O carimbo só é exigido de PR que MEXE em teste.
      - name: O PR altera testes?
        if: github.event_name == 'pull_request'
        run: |
          set -euo pipefail
          changed=$(git diff --name-only --diff-filter=d \
            "origin/${{ github.base_ref }}..HEAD" \
            -- '*.spec.ts' '*.test.ts' '*.test.tsx' '*.selfcheck.ts' 'e2e/**')
          if [ -n "$changed" ]; then
            echo "REQUIRE_ENTRY=1" >> "$GITHUB_ENV"
            printf 'carimbo exigido:\n%s\n' "$changed"
          fi

      - name: Guarda anti-drift (números + append-only)
        env:
          REPORT_BASE_REF: ${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || '' }}
        run: pnpm test:report:check

      - name: Guarda — entrega carimbada?
        if: env.REQUIRE_ENTRY == '1'
        run: pnpm test:report:check --require-entry
```

Ajuste os globs de `*.spec.ts` etc. à convenção do outro projeto.

---

## As três guardas (e por que são três)

| # | Prova | Pega |
|---|---|---|
| 1 | Números batem com execução limpa | número editado à mão |
| 2 | Append-only por continência | histórico apagado |
| 3 | Entrega tem linha no histórico | histórico **nunca escrito** |

Cada uma nasceu de um bug real. Nenhuma cobre a falha da outra.

---

## Armadilhas — todas custaram CI verde mentindo

1. **`git diff ...` (três pontos) quebra no fetch raso.** Precisa do ancestral
   comum, que `--depth=1` não traz: dá `fatal: no merge base`, a variável fica
   vazia e a guarda **se dispensa sozinha**. Use `..` (dois pontos) e
   `set -euo pipefail` — o passo deve **falhar** quando o git falha.
   *Guarda que falha aberta é pior que guarda nenhuma.*

2. **O arquivo de teste do próprio gerador não casa `*.spec.ts`.** Inclua
   `*.selfcheck.ts` (ou o sufixo equivalente) nos globs, senão o PR que mexe na
   guarda escapa dela.

3. **Extrair a SPEC do corpo do PR pega a menção errada.** O corpo cita outras
   specs em prosa. Use o **título**, onde a spec da entrega está entre colchetes.

4. **O CI de `pull_request` usa o workflow da BASE, não o do branch.** Mudança no
   `ci.yml` só é exercitada **depois do merge** — não conte como testada antes disso.

5. **Nunca confie no check verde: leia o log.** Confirme que o passo emitiu a
   linha esperada (`Entrega #N carimbada no histórico`). Um passo condicional que
   nunca roda passa verde exatamente como um que roda e aprova.

---

## Como carimbar uma entrega localmente

```bash
REPORT_ISSUE=#103 REPORT_SPEC=SPEC-027 REPORT_PR=#104 pnpm test:report
```

Sem essas variáveis o gerador atualiza só o `Estado atual` e **não** acrescenta
linha — `| — | — | — |` não é evidência de entrega. É por isso que a guarda 3
existe: sem ela, esquecer é silencioso.

---

## O que fica de fora

O gerador lê o formato `--json` de **jest / vitest / playwright**. Outro runner
exige adaptar a leitura dos resultados (`buildRows`). A ideia das três guardas
viaja para qualquer stack; este código, não.

_Extraído da experiência real deste repo em 2026-07-22 (issue #110)._
