/**
 * Gerador do relatório de testes (ADR-019). Repo-agnóstico: lê tudo de
 * `test-report.config.json` — o único arquivo que muda por projeto. Os NÚMEROS
 * vêm sempre da saída `--json` dos runners (jest/vitest/playwright) + o
 * `coverage-summary.json`; nada é digitado à mão. É a nossa própria filosofia
 * (evidência de máquina, nunca narrada) aplicada ao nosso CI.
 *
 * Uso:
 *   ts-node scripts/gen-test-report.ts            # gera/atualiza reports/TESTS.md
 *   ts-node scripts/gen-test-report.ts --check    # falha (exit 1) se divergir
 *
 * Metadados da entrega (linha do registro) via env:
 *   REPORT_DATE (YYYY-MM-DD) · REPORT_ISSUE (#N) · REPORT_SPEC · REPORT_PR (#N)
 *   REPORT_PR_URL (link do PR; sem ela, monta de `repoUrl` do config + o número)
 * Ausentes → '—' (o relatório continua verdadeiro nos números, que é o que o
 * --check verifica; metadados são rótulos humanos).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT, 'test-report.config.json');

interface CategoryConfig {
  name: string;
  runner: string;
  resultsJson: string;
  playwrightJson?: string;
  coverageSummary?: string;
}
interface Config {
  reportPath: string;
  /** Base do repo (ex.: https://github.com/owner/repo) para montar o link do PR
   *  quando o CI não injeta REPORT_PR_URL. Opcional — sem ele a coluna fica '—'. */
  repoUrl?: string;
  categories: CategoryConfig[];
}

interface Row {
  category: string;
  tests: number;
  pass: number;
  fail: number;
  coverage: string; // "91.2" ou "—" (E2E não tem cobertura de linha)
}

const HEADER = [
  '<!-- GERADO AUTOMATICAMENTE por scripts/gen-test-report.ts — NÃO EDITAR À MÃO.',
  '     Fonte dos números: jest/vitest/playwright --json. Divergência é barrada no CI. -->',
].join('\n');

const TABLE_HEADER =
  '| Data | Issue | SPEC | Categoria | Testes | Pass | Falha | Cobertura % | PR | Link PR |\n' +
  '|------|-------|------|-----------|-------:|-----:|------:|------------:|----:|--------|';

function loadConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Config;
}

/** Lê a saída `--json` de um runner (jest OU vitest — ambos expõem numTotal/…). */
function readRunnerJson(path: string): { total: number; passed: number; failed: number } {
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return { total: 0, passed: 0, failed: 0 };
  const j = JSON.parse(readFileSync(abs, 'utf-8')) as {
    numTotalTests?: number;
    numPassedTests?: number;
    numFailedTests?: number;
  };
  return {
    total: j.numTotalTests ?? 0,
    passed: j.numPassedTests ?? 0,
    failed: j.numFailedTests ?? 0,
  };
}

/** Lê o JSON do Playwright (formato próprio: suites/specs com stats). */
function readPlaywrightJson(path: string): { total: number; passed: number; failed: number } {
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return { total: 0, passed: 0, failed: 0 };
  const j = JSON.parse(readFileSync(abs, 'utf-8')) as {
    stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  };
  const s = j.stats ?? {};
  const passed = s.expected ?? 0;
  const failed = (s.unexpected ?? 0) + (s.flaky ?? 0);
  return { total: passed + failed, passed, failed };
}

/** Cobertura de linhas (%) do coverage-summary.json, ou '—' se ausente. */
function readCoverage(path?: string): string {
  if (!path) return '—';
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return '—';
  const j = JSON.parse(readFileSync(abs, 'utf-8')) as {
    total?: { lines?: { pct?: number } };
  };
  const pct = j.total?.lines?.pct;
  return typeof pct === 'number' ? pct.toFixed(1) : '—';
}

function buildRows(cfg: Config): Row[] {
  return cfg.categories.map((cat) => {
    const runner = readRunnerJson(cat.resultsJson);
    const pw = cat.playwrightJson
      ? readPlaywrightJson(cat.playwrightJson)
      : { total: 0, passed: 0, failed: 0 };
    return {
      category: cat.name,
      tests: runner.total + pw.total,
      pass: runner.passed + pw.passed,
      fail: runner.failed + pw.failed,
      coverage: readCoverage(cat.coverageSummary),
    };
  });
}

interface Meta {
  date: string;
  issue: string;
  spec: string;
  pr: string;
  /** Link markdown clicável do PR (ou '—'). */
  prLink: string;
}

/**
 * Metadados da entrega. O link do PR vem de `REPORT_PR_URL` (o CI tem a URL
 * pronta em `github.event.pull_request.html_url`); sem ela, monta de
 * `repoUrl` do config + o número do PR. Sem nenhum dos dois → '—'. O gerador
 * não conhece GitHub nem lê o git remote — segue repo-agnóstico (§7).
 */
function buildMeta(cfg: Config): Meta {
  const pr = envOrDash('REPORT_PR');
  return {
    date: envOrDash('REPORT_DATE'),
    issue: envOrDash('REPORT_ISSUE'),
    spec: envOrDash('REPORT_SPEC'),
    pr,
    prLink: prLinkOf(pr, cfg.repoUrl),
  };
}

/** Env ausente OU vazia → '—'. O CI exporta a var vazia quando o PR não traz o
 *  metadado (ex.: sem `refs #N` no corpo); vazio é ausência, não um rótulo. */
function envOrDash(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : '—';
}

/** `#62` + base → `[#62](https://…/pull/62)`. Sem número ou sem base → '—'. */
function prLinkOf(pr: string, repoUrl?: string): string {
  const fromEnv = process.env.REPORT_PR_URL?.trim();
  const url = fromEnv || urlFromBase(pr, repoUrl);
  return url && pr !== '—' ? `[${pr}](${url})` : '—';
}

function urlFromBase(pr: string, repoUrl?: string): string | null {
  const num = pr.replace(/^#/, '');
  if (!repoUrl || !/^\d+$/.test(num)) return null;
  return `${repoUrl.replace(/\/+$/, '')}/pull/${num}`;
}

/** Preenchido em `main` assim que o config é lido (o link do PR depende dele). */
let meta: Meta;

function rowLine(r: Row, m: Meta): string {
  return `| ${m.date} | ${m.issue} | ${m.spec} | ${r.category} | ${r.tests} | ${r.pass} | ${r.fail} | ${r.coverage} | ${m.pr} | ${m.prLink} |`;
}

const HISTORY_MARKER = '## Histórico por entrega';
const ESTADO_MARKER = '## Estado atual';

/**
 * Normaliza a quebra de linha antes de qualquer comparação. O gerador emite LF;
 * o arquivo commitado chega com CRLF num checkout Windows (`core.autocrlf`).
 * Sem isto o `--check` acusava divergência entre blocos idênticos — cada linha
 * diferia por um `\r` invisível no print do erro. Um guard que falha sempre é um
 * guard que ninguém lê: falhar em número certo é o mesmo que não falhar em
 * número errado.
 */
function lf(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

/**
 * Bloco "Estado atual" (só os números, metadados neutros) — é o que a guarda
 * anti-drift compara. Isola os números da forja sem depender dos rótulos
 * Data/Issue/PR, que legitimamente variam por PR.
 */
function estadoAtualBlock(docRaw: string): string {
  const doc = lf(docRaw);
  const start = doc.indexOf(ESTADO_MARKER);
  if (start === -1) return '';
  const rest = doc.slice(start);
  const end = rest.indexOf(HISTORY_MARKER);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/**
 * Linhas do histórico já commitadas. Lê SÓ a seção após o marcador de
 * histórico — o "Estado atual" é sempre regenerado e nunca deve realimentar o
 * histórico.
 */
export function keepHistory(existingRaw: string): string[] {
  const existing = lf(existingRaw);
  const idx = existing.indexOf(HISTORY_MARKER);
  if (idx === -1) return [];
  const section = existing.slice(idx);
  const out: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ') || line.includes('---')) continue;
    if (line.includes('| Data |')) continue;
    // Toda linha commitada fica. Append-only significa isto e nada mais.
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * O histórico é **append-only** (TESTING.md §4): linha commitada nunca é
 * reescrita nem descartada. Duas regras, ambas nascidas de bugs reais:
 *
 * 1. **Sem issue não apaga.** A versão anterior fazia
 *    `meta.issue !== '—' ? keepHistory(...) : []` — rodar `pnpm test:report`
 *    local (sem PR, logo sem `refs #N`) **zerava o histórico inteiro**. Foi
 *    assim que o registro da SPEC-016 sumiu, em 2026-07-16. Agora o histórico
 *    é sempre preservado.
 * 2. **Sem issue não acrescenta.** Uma linha `| — | — | — |` não é evidência
 *    de entrega: não diz o que foi entregue nem por qual PR. Rodar local
 *    atualiza só o `Estado atual` — que é regenerado por contrato.
 *
 * O "upsert" que a versão anterior fazia (remover as linhas da issue atual
 * antes de reescrevê-las) **contradizia o append-only** e foi removido: uma
 * reentrega da mesma issue agora vira uma linha nova, datada. Duas execuções
 * são dois fatos, não uma correção.
 */
export function render(rows: Row[], existing: string, m: Meta): string {
  const history = existing ? keepHistory(existing) : [];
  const newLines = m.issue !== '—' ? rows.map((r) => rowLine(r, m)) : [];
  const allLines = [...history, ...newLines];

  const estadoAtual =
    '## Estado atual\n\n' +
    'Totais da última execução (regenerado, não acumulado):\n\n' +
    TABLE_HEADER +
    '\n' +
    rows
      .map(
        (r) =>
          `| — | — | — | ${r.category} | ${r.tests} | ${r.pass} | ${r.fail} | ${r.coverage} | — | — |`,
      )
      .join('\n');

  const historico =
    HISTORY_MARKER + '\n\n' +
    'Append-only — linhas de entregas passadas são imutáveis.\n\n' +
    TABLE_HEADER +
    '\n' +
    allLines.join('\n');

  return [
    HEADER,
    '',
    '# TESTS.md — Registro de evidência de testes',
    '',
    '> Gerado por `scripts/gen-test-report.ts` (ADR-019). Números vêm do `--json`',
    '> dos runners. Ver `docs/TESTING.md` para a metodologia.',
    '',
    estadoAtual,
    '',
    historico,
    '',
  ].join('\n');
}

/**
 * Linhas do histórico de `before` que não sobreviveram em `after`.
 *
 * Append-only é **verificável por continência**, não por igualdade: o histórico
 * novo pode ter linhas a mais (a entrega atual), nunca a menos. Comparar os
 * blocos inteiros exigiria que Data/Issue/PR batessem — os metadados que variam
 * legitimamente por PR, e a razão de o `--check` olhar só os números do "Estado
 * atual" (§5). Continência não sofre desse problema: não compara metadados,
 * exige que cada linha já registrada continue lá.
 *
 * **O `before` tem de ser independente do arquivo auditado.** A primeira versão
 * desta guarda comparava o arquivo com a saída de `render(…, existing)` — que é
 * construída A PARTIR do próprio arquivo via `keepHistory`. Histórico apagado
 * ⇒ os dois lados vinham vazios ⇒ "íntegro". A guarda comparava o arquivo
 * corrompido consigo mesmo e passava. Por isso o call site usa como baseline o
 * blob do git na base do PR (`reportAtBase`): a evidência de que uma linha
 * existia não pode vir de dentro do arquivo que a apagou.
 */
export function droppedHistory(before: string, after: string): string[] {
  const kept = new Set(keepHistory(after));
  return keepHistory(before).filter((line) => !kept.has(line));
}

/**
 * O relatório na revisão-baseline — a referência independente do append-only.
 *
 * Qual revisão importa: no CI de PR o checkout deixa HEAD no **merge commit**,
 * cujo `reports/TESTS.md` é a versão do próprio PR — comparar com ela seria o
 * mesmo auto-testemunho que essa guarda existe para fechar. A baseline correta
 * é o alvo do PR (`origin/main`), que é o histórico ao qual o PR acrescenta.
 * `REPORT_BASE_REF` deixa o CI dizer isso explicitamente; local, HEAD serve.
 *
 * Sem git, sem a ref, ou arquivo inexistente na baseline → null: não há
 * histórico anterior a proteger e a guarda não tem o que provar. Nunca derruba
 * o CI por ausência de git; só por linha que sumiu.
 */
function reportAtBase(cfg: Config): string | null {
  const ref = process.env.REPORT_BASE_REF?.trim() || 'HEAD';
  try {
    return execFileSync('git', ['show', `${ref}:${cfg.reportPath}`], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // sem git, ref ausente, ou arquivo novo na baseline
  }
}

function main() {
  const check = process.argv.includes('--check');
  const cfg = loadConfig();
  meta = buildMeta(cfg);
  const reportAbs = resolve(ROOT, cfg.reportPath);
  const existing = existsSync(reportAbs) ? readFileSync(reportAbs, 'utf-8') : '';
  const rows = buildRows(cfg);
  const next = render(rows, existing, meta);

  if (check) {
    // Duas provas independentes, porque são duas formas de forjar:
    //   1. NÚMEROS — só a seção "Estado atual" (metadados neutros); não os
    //      rótulos Data/Issue/PR, que variam por PR (decisão do PI). Pega o
    //      número editado à mão sem forçar cada PR a pré-commitar metadados.
    //   2. HISTÓRICO — append-only por continência contra o git HEAD (ver
    //      `droppedHistory`). Números certos e histórico zerado passavam batido
    //      até 2026-07-16.
    const committed = estadoAtualBlock(existing);
    const fresh = estadoAtualBlock(next);
    if (committed !== fresh) {
      console.error(
        '[gen-test-report] DIVERGÊNCIA de NÚMEROS: reports/TESTS.md não bate com uma execução limpa.\n' +
          'Rode `pnpm test:report` e commite o resultado. Números não podem ser editados à mão (ADR-019).\n' +
          `--- commitado ---\n${committed}\n--- execução limpa ---\n${fresh}`,
      );
      process.exit(1);
    }

    // Baseline = git (base do PR), nunca `existing`: o arquivo não pode ser
    // testemunha da própria integridade (histórico apagado "concorda" consigo).
    const base = reportAtBase(cfg);
    const dropped = base ? droppedHistory(base, existing) : [];
    if (dropped.length) {
      console.error(
        '[gen-test-report] HISTÓRICO PERDIDO: o append-only foi violado — ' +
          `${dropped.length} linha(s) commitada(s) sumiram de ${cfg.reportPath} (TESTING.md §4).\n` +
          'Linha de entrega passada é imutável: restaure-as (git checkout HEAD -- ' +
          `${cfg.reportPath}) e rode \`pnpm test:report\` de novo.\n` +
          `--- linhas perdidas ---\n${dropped.join('\n')}`,
      );
      process.exit(1);
    }

    console.log(
      '[gen-test-report] --check OK: os números batem com a execução limpa e o histórico está íntegro.',
    );
    return;
  }

  const dir = dirname(reportAbs);
  if (!existsSync(dir)) execFileSync('node', ['-e', `require('fs').mkdirSync('${dir.replace(/\\/g, '\\\\')}',{recursive:true})`]);
  writeFileSync(reportAbs, next, 'utf-8');
  console.log(`[gen-test-report] escrito ${cfg.reportPath}:`);
  for (const r of rows) {
    console.log(`  ${r.category}: ${r.tests} testes, ${r.pass} pass, ${r.fail} falha, cob ${r.coverage}%`);
  }
}

// Só executa quando chamado como script — assim o teste importa `render` e
// `keepHistory` sem disparar os runners.
if (require.main === module) main();
