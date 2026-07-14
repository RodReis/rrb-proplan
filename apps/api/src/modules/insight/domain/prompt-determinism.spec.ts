import { computeInputHash } from './input-hash';
import { buildSummaryUser, SUMMARY_SYSTEM } from './summary-prompt';
import { buildEdgesUser, EDGES_SYSTEM } from './edges-prompt';
import { buildClassifyUser, CLASSIFY_SYSTEM } from './classify-prompt';
import { buildFallbackUser, FALLBACK_SYSTEM } from './fallback-prompt';

/**
 * Mitiga o risco central da SPEC-011 (nota técnica): um prompt NÃO-determinístico
 * (data/hora, ordenação instável) faria o inputHash mudar a cada sync e o gate
 * nunca acertaria — silenciosamente, sem erro. Aqui rodamos cada builder real
 * DUAS vezes sobre os mesmos docs e exigimos hash idêntico. Se alguém introduzir
 * não-determinismo num prompt, este teste quebra antes de virar gasto invisível.
 */

const provider = 'anthropic';
const model = 'claude-sonnet-5';

const textDocs = [
  { path: 'README.md', content: '# Projeto\n\nUm sistema.' },
  { path: 'docs/STATUS.md', content: '# Status\n\n## A Fazer\n- x' },
];
const metaDocs = [
  { path: 'docs/a.md', title: 'A', headings: ['H1', 'H2'], excerpt: '# A\ntexto' },
  { path: 'docs/b.md', title: 'B', headings: ['H3'], excerpt: '# B\ntexto' },
];

function hashOf(system: string, user: string): string {
  return computeInputHash({ system, user, provider, model });
}

describe('determinismo do prompt → inputHash estável (risco SPEC-011)', () => {
  it('summary: mesmos docs → mesmo hash', () => {
    const a = hashOf(SUMMARY_SYSTEM, buildSummaryUser(textDocs));
    const b = hashOf(SUMMARY_SYSTEM, buildSummaryUser(textDocs));
    expect(a).toBe(b);
  });

  it('edges: mesmos docs → mesmo hash', () => {
    const explicit = [{ source: 'docs/a.md', target: 'docs/b.md' }];
    const a = hashOf(EDGES_SYSTEM, buildEdgesUser(metaDocs, explicit));
    const b = hashOf(EDGES_SYSTEM, buildEdgesUser(metaDocs, explicit));
    expect(a).toBe(b);
  });

  it('classify: mesmos docs → mesmo hash', () => {
    const a = hashOf(CLASSIFY_SYSTEM, buildClassifyUser(metaDocs, ['architecture']));
    const b = hashOf(CLASSIFY_SYSTEM, buildClassifyUser(metaDocs, ['architecture']));
    expect(a).toBe(b);
  });

  it('fallback: mesmos docs → mesmo hash', () => {
    const a = hashOf(FALLBACK_SYSTEM, buildFallbackUser(textDocs, 'architecture'));
    const b = hashOf(FALLBACK_SYSTEM, buildFallbackUser(textDocs, 'architecture'));
    expect(a).toBe(b);
  });

  it('mudar um doc muda o hash do summary (o gate não é "nunca regenerar")', () => {
    const a = hashOf(SUMMARY_SYSTEM, buildSummaryUser(textDocs));
    const changed = [textDocs[0], { path: 'docs/STATUS.md', content: '# Status\n\n## Feito\n- x' }];
    const b = hashOf(SUMMARY_SYSTEM, buildSummaryUser(changed));
    expect(a).not.toBe(b);
  });
});
