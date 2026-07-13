import {
  parseProplanConfig,
  mergeProplanConfig,
  serializeProplanConfig,
} from './proplan-config';

describe('parseProplanConfig', () => {
  it('parseia mapping válido', () => {
    const yaml = `proplan: v2\nmapping:\n  architecture: docs/notas.md\n  deploy: null\n`;
    const { config, invalid } = parseProplanConfig(yaml);
    expect(invalid).toBe(false);
    expect(config?.mapping.architecture).toBe('docs/notas.md');
    expect(config?.mapping.deploy).toBeNull();
  });

  it('arquivo ausente → config null, não inválido', () => {
    const { config, invalid } = parseProplanConfig(null);
    expect(config).toBeNull();
    expect(invalid).toBe(false);
  });

  it('YAML quebrado → invalid true, não lança', () => {
    const { config, invalid } = parseProplanConfig('mapping: [: : :');
    expect(config).toBeNull();
    expect(invalid).toBe(true);
  });

  it('ignora chaves de entidade desconhecidas', () => {
    const yaml = `proplan: v2\nmapping:\n  banana: x.md\n  design: docs/d.md\n`;
    const { config } = parseProplanConfig(yaml);
    expect(config?.mapping.design).toBe('docs/d.md');
    expect((config?.mapping as Record<string, unknown>).banana).toBeUndefined();
  });
});

describe('mergeProplanConfig + serializeProplanConfig', () => {
  it('mescla entidade preservando as demais', () => {
    const base = { mapping: { architecture: 'docs/a.md' } };
    const merged = mergeProplanConfig(base, 'deploy', null);
    expect(merged.mapping.architecture).toBe('docs/a.md');
    expect(merged.mapping.deploy).toBeNull();
  });

  it('serializa round-trip parseável com proplan: v2', () => {
    const cfg = { mapping: { testing: 'docs/qa/e.md', deploy: null } };
    const yaml = serializeProplanConfig(cfg);
    expect(yaml).toContain('proplan: v2');
    const { config } = parseProplanConfig(yaml);
    expect(config?.mapping.testing).toBe('docs/qa/e.md');
    expect(config?.mapping.deploy).toBeNull();
  });
});
