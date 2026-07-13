import { resolveDocuments } from './document-resolver';

const doc = (path: string, isConventional = false) => ({ path, isConventional });

describe('DocumentResolver — fixtures de repo (SPEC-006)', () => {
  it('repo-convenção: tudo nível 1, sem alias', () => {
    const docs = [
      doc('docs/ARCHITECTURE.md', true),
      doc('docs/DECISIONS.md', true),
      doc('docs/DESIGN.md', true),
      doc('docs/TESTING.md', true),
      doc('docs/DEPLOY.md', true),
      doc('CLAUDE.md', true),
    ];
    const res = resolveDocuments({ docs, config: null });
    expect(res.every((r) => r.level === 1)).toBe(true);
    expect(res.some((r) => r.source === 'alias')).toBe(false);
  });

  it('repo-nomes-próprios: tudo nível 2 (O TESTE QUE PROVA A FATIA)', () => {
    const docs = [
      doc('docs/arquitetura.md'),
      doc('adr/0001-orm.md'),
      doc('adr/0002-filas.md'),
      doc('docs/qa/estrategia.md'),
      doc('docs/ui.md'),
      doc('DEPLOY.md'),
      doc('AGENTS.md'),
    ];
    const res = resolveDocuments({ docs, config: null });
    expect(res.find((r) => r.entity === 'architecture')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'decisions')!.paths).toEqual([
      'adr/0001-orm.md',
      'adr/0002-filas.md',
    ]);
    expect(res.find((r) => r.entity === 'testing')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'design')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'deploy')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'skills')!.level).toBe(2);
  });

  it('repo-vazio: tudo nível 4, nada inventa', () => {
    const res = resolveDocuments({ docs: [doc('README.md')], config: null });
    expect(res.every((r) => r.level === 4)).toBe(true);
  });
});
