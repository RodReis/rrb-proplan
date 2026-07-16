/**
 * Self-check do gerador de relatório (ADR-019). Roda com
 * `npx ts-node scripts/gen-test-report.selfcheck.ts` — sem framework, sem
 * fixture, sem DB.
 *
 * Por que não é jest: o jest da API tem `rootDir: apps/api` e `scripts/` fica
 * fora; o import atravessa a fronteira e o ts-jest recusa. Onde o teste de
 * script deve morar de vez (project novo no jest.config vs runner na raiz) é
 * decisão do PI e está registrado no STATUS.md. Até lá, isto é o que impede o
 * append-only de voltar a quebrar em silêncio — que foi exatamente o que
 * aconteceu desde o primeiro commit do ADR-019.
 */
import { strict as assert } from 'node:assert';

import { droppedHistory, keepHistory } from './gen-test-report';

const LINHA_A =
  '| 2026-07-16 | #3 | SPEC-016 | Regras de Negócio | 501 | 501 | 0 | 76.7 | #65 | [#65](https://x/pull/65) |';
const LINHA_B = '| 2026-07-16 | #3 | SPEC-016 | Banco | 0 | 0 | 0 | — | #65 | [#65](https://x/pull/65) |';
const LINHA_NOVA =
  '| 2026-07-17 | #70 | SPEC-020 | Regras de Negócio | 536 | 536 | 0 | 78.2 | #71 | [#71](https://x/pull/71) |';

const TABLE_HEADER =
  '| Data | Issue | SPEC | Categoria | Testes | Pass | Falha | Cobertura % | PR | Link PR |\n' +
  '|------|-------|------|-----------|-------:|-----:|------:|------------:|----:|--------|';

/** Documento mínimo com as duas seções, como o gerador escreve. */
function doc(historico: string[], estadoAtual: string[] = []): string {
  return [
    '## Estado atual',
    '',
    TABLE_HEADER,
    ...estadoAtual,
    '',
    '## Histórico por entrega',
    '',
    TABLE_HEADER,
    ...historico,
    '',
  ].join('\n');
}

function run(nome: string, fn: () => void): void {
  fn();
  console.log(`  ok — ${nome}`);
}

console.log('[selfcheck] gen-test-report');

run('keepHistory lê só a seção de histórico, nunca o Estado atual', () => {
  const estadoAtual = ['| — | — | — | Regras de Negócio | 509 | 509 | 0 | 78.2 | — | — |'];
  assert.deepEqual(keepHistory(doc([LINHA_A], estadoAtual)), [LINHA_A]);
});

run('keepHistory ignora cabeçalho e separador da tabela', () => {
  const linhas = keepHistory(doc([LINHA_A, LINHA_B]));
  assert.deepEqual(linhas, [LINHA_A, LINHA_B]);
});

run('append puro: nada perdido quando só acrescenta', () => {
  const antes = doc([LINHA_A, LINHA_B]);
  const depois = doc([LINHA_A, LINHA_B, LINHA_NOVA]);
  assert.deepEqual(droppedHistory(antes, depois), []);
});

run('idêntico: nada perdido', () => {
  const d = doc([LINHA_A, LINHA_B]);
  assert.deepEqual(droppedHistory(d, d), []);
});

run('O BUG DA SPEC-016: histórico zerado é detectado', () => {
  const antes = doc([LINHA_A, LINHA_B]);
  const zerado = doc([]);
  assert.deepEqual(droppedHistory(antes, zerado), [LINHA_A, LINHA_B]);
});

run('linha commitada reescrita (upsert) conta como perdida', () => {
  const antes = doc([LINHA_A]);
  const adulterada = doc([LINHA_A.replace('501 | 501', '999 | 999')]);
  assert.deepEqual(droppedHistory(antes, adulterada), [LINHA_A]);
});

run('uma sumindo no meio é detectada, as outras não viram falso positivo', () => {
  const antes = doc([LINHA_A, LINHA_B, LINHA_NOVA]);
  const depois = doc([LINHA_A, LINHA_NOVA]);
  assert.deepEqual(droppedHistory(antes, depois), [LINHA_B]);
});

run('primeira execução (sem histórico anterior) não acusa perda', () => {
  assert.deepEqual(droppedHistory('', doc([LINHA_NOVA])), []);
});

run('CRLF (checkout Windows) não vira falso positivo', () => {
  const commitado = doc([LINHA_A, LINHA_B]).replace(/\n/g, '\r\n'); // como o git entrega
  const gerado = doc([LINHA_A, LINHA_B]); // como o gerador emite (LF)
  assert.deepEqual(droppedHistory(commitado, gerado), []);
  assert.deepEqual(keepHistory(commitado), [LINHA_A, LINHA_B]);
});

run('CRLF não mascara perda real', () => {
  const commitado = doc([LINHA_A, LINHA_B]).replace(/\n/g, '\r\n');
  assert.deepEqual(droppedHistory(commitado, doc([LINHA_A])), [LINHA_B]);
});

console.log('[selfcheck] OK — 10 checks');
