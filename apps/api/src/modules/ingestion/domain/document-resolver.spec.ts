import { resolveDocuments } from './document-resolver';

const doc = (path: string, isConventional = false) => ({ path, isConventional });

describe('resolveDocuments — escada ADR-014', () => {
  it('nível 1: convenção (path exato + proplan:v1)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/ARCHITECTURE.md', true)],
      config: null,
    });
    const arch = res.find((r) => r.entity === 'architecture')!;
    expect(arch.level).toBe(1);
    expect(arch.source).toBe('convention');
    expect(arch.path).toBe('docs/ARCHITECTURE.md');
    expect(arch.confidence).toBe(1);
  });

  it('path canônico SEM frontmatter proplan:v1 NÃO é nível 1 (cai pra alias)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/ARCHITECTURE.md', false)],
      config: null,
    });
    const arch = res.find((r) => r.entity === 'architecture')!;
    expect(arch.level).toBe(2);
    expect(arch.source).toBe('alias');
  });

  it('nível 2: alias (nomes próprios, sem frontmatter)', () => {
    const res = resolveDocuments({
      docs: [
        doc('docs/arquitetura.md'),
        doc('adr/0001-x.md'),
        doc('docs/qa/estrategia.md'),
      ],
      config: null,
    });
    expect(res.find((r) => r.entity === 'architecture')!.level).toBe(2);
    expect(res.find((r) => r.entity === 'architecture')!.path).toBe('docs/arquitetura.md');
    const dec = res.find((r) => r.entity === 'decisions')!;
    expect(dec.level).toBe(2);
    expect(dec.paths).toEqual(['adr/0001-x.md']); // coleção
    expect(dec.path).toBeNull();
    expect(res.find((r) => r.entity === 'testing')!.path).toBe('docs/qa/estrategia.md');
  });

  it('nível 4: ausente quando nada casa', () => {
    const res = resolveDocuments({ docs: [doc('README.md')], config: null });
    const dep = res.find((r) => r.entity === 'deploy')!;
    expect(dep.level).toBe(4);
    expect(dep.source).toBe('absent');
    expect(dep.confidence).toBe(0);
  });

  it('config vence convenção (aponta outro arquivo)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/ARCHITECTURE.md', true), doc('docs/notas.md')],
      config: { mapping: { architecture: 'docs/notas.md' } },
    });
    const arch = res.find((r) => r.entity === 'architecture')!;
    expect(arch.source).toBe('config');
    expect(arch.path).toBe('docs/notas.md');
  });

  it('config null explícito → ausência confirmada (source config)', () => {
    const res = resolveDocuments({
      docs: [doc('docs/DEPLOY.md', true)],
      config: { mapping: { deploy: null } },
    });
    const dep = res.find((r) => r.entity === 'deploy')!;
    expect(dep.level).toBe(4);
    expect(dep.source).toBe('config');
    expect(dep.path).toBeNull();
  });

  it('config apontando diretório → coleção', () => {
    const res = resolveDocuments({
      docs: [doc('minhas-decisoes/a.md'), doc('minhas-decisoes/b.md')],
      config: { mapping: { decisions: 'minhas-decisoes/' } },
    });
    const dec = res.find((r) => r.entity === 'decisions')!;
    expect(dec.source).toBe('config');
    expect(dec.paths.sort()).toEqual(['minhas-decisoes/a.md', 'minhas-decisoes/b.md']);
  });

  it('sempre devolve as 6 entidades', () => {
    const res = resolveDocuments({ docs: [], config: null });
    expect(res.map((r) => r.entity).sort()).toEqual(
      ['architecture', 'decisions', 'deploy', 'design', 'skills', 'testing'],
    );
  });
});
