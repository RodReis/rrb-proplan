/**
 * Orquestrador do relatório de testes (ADR-019). Roda os runners com saída
 * `--json` nos caminhos que o `test-report.config.json` espera, depois chama o
 * gerador. Portável (Windows dev + Linux CI): usa spawn, não shell.
 *
 *   node scripts/test-report.mjs             # roda tudo + gera reports/TESTS.md
 *   node scripts/test-report.mjs --check     # roda tudo + falha se divergir
 *   node scripts/test-report.mjs --no-run    # só gera do que já existe em reports/.raw
 *   node scripts/test-report.mjs --selfcheck # só prova o gerador (não roda runners)
 *   node scripts/test-report.mjs --check --require-entry
 *                                            # + exige linha da entrega no histórico
 *                                            # (CI, em PR que altera teste — issue #110)
 *
 * Testes que falham NÃO abortam o relatório — o número de falhas é o dado. Só o
 * gerador (via --check) barra o CI, e por divergência de número, não por falha.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RAW = resolve(ROOT, 'reports/.raw');
const check = process.argv.includes('--check');
const selfcheck = process.argv.includes('--selfcheck');
const noRun = process.argv.includes('--no-run') || selfcheck;
const isWin = process.platform === 'win32';

function run(cmd, args, cwd) {
  console.log(`\n$ ${cmd} ${args.join(' ')}  (${cwd})`);
  // shell:true no Windows para resolver o .cmd do npx/pnpm (spawn não acha .cmd sem shell).
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env, shell: isWin });
  if (r.error) console.error(`  ! falhou ao executar: ${r.error.message}`);
  // Não aborta em falha de teste: a contagem de falhas é o dado do relatório.
  return r.status ?? 0;
}

if (!noRun) {
  mkdirSync(RAW, { recursive: true });
  const api = resolve(ROOT, 'apps/api');
  const web = resolve(ROOT, 'apps/web');

  // API — um JSON por project (categoria), com cobertura por diretório próprio.
  run('npx', ['jest', '--selectProjects', 'regras', '--coverage',
    '--coverageDirectory', 'coverage/regras', '--coverageReporters', 'json-summary',
    '--json', '--outputFile', resolve(RAW, 'api-regras.json')], api);
  run('npx', ['jest', '--selectProjects', 'banco', '--passWithNoTests', '--coverage',
    '--coverageDirectory', 'coverage/banco', '--coverageReporters', 'json-summary',
    '--json', '--outputFile', resolve(RAW, 'api-banco.json')], api);

  // Web — Vitest (componente) com cobertura + JSON; Playwright (E2E) JSON.
  run('npx', ['vitest', 'run', '--coverage', '--reporter=json',
    '--outputFile', resolve(RAW, 'web-vitest.json')], web);
  // Playwright: reporter json com destino via env (PLAYWRIGHT_JSON_OUTPUT_NAME é
  // o caminho oficial; sem ele o JSON iria pro stdout). Escreve direto no raw.
  const pwEnv = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(RAW, 'web-playwright.json') };
  console.log(`\n$ npx playwright test --reporter=json  (${web})`);
  spawnSync('npx', ['playwright', 'test', '--reporter=json'],
    { cwd: web, stdio: 'inherit', env: pwEnv, shell: isWin });
}

// Gera (ou verifica) o relatório a partir dos JSONs. ts-node vem da API; força
// module=commonjs via env (o gerador usa __dirname/require; passar o objeto pela
// flag --compiler-options quebra no shell do Windows — a env é à prova de aspas).
process.env.TS_NODE_COMPILER_OPTIONS = '{"module":"commonjs"}';
const entry = selfcheck ? 'scripts/gen-test-report.selfcheck.ts' : 'scripts/gen-test-report.ts';
const genArgs = ['ts-node', resolve(ROOT, entry)];
if (check) genArgs.push('--check');
// Repasse explícito: o wrapper filtra as flags que conhece, então uma flag nova
// do gerador seria descartada em silêncio — e uma guarda que nunca roda é pior
// que guarda nenhuma, porque parece estar protegendo (issue #110).
if (process.argv.includes('--require-entry')) genArgs.push('--require-entry');
// cwd = apps/api: é de lá que o ts-node resolve (o script vive fora de qualquer workspace).
const status = run('npx', genArgs, resolve(ROOT, 'apps/api'));
process.exit(status);
