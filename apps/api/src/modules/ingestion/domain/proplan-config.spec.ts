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

describe('deploy.prodUrls (SPEC-013)', () => {
  it('lista de strings → DeclaredProdUrl com platform null', () => {
    const yaml = `deploy:\n  prodUrls:\n    - https://a.netlify.app\n    - https://b.up.railway.app\n`;
    const { config } = parseProplanConfig(yaml);
    expect(config?.deployProdUrls).toEqual([
      { url: 'https://a.netlify.app', platform: null },
      { url: 'https://b.up.railway.app', platform: null },
    ]);
  });

  it('item objeto {url, platform} → platform preservada (domínio próprio)', () => {
    const yaml = `deploy:\n  prodUrls:\n    - url: https://gestao.exemplo.com.br\n      platform: netlify\n`;
    const { config } = parseProplanConfig(yaml);
    expect(config?.deployProdUrls).toEqual([
      { url: 'https://gestao.exemplo.com.br', platform: 'netlify' },
    ]);
  });

  it('config sem deploy → lista vazia (não inválido)', () => {
    const { config, invalid } = parseProplanConfig('mapping:\n  design: d.md\n');
    expect(invalid).toBe(false);
    expect(config?.deployProdUrls).toEqual([]);
  });

  it('itens lixo (número, objeto sem url) são ignorados', () => {
    const yaml = `deploy:\n  prodUrls:\n    - 42\n    - platform: x\n    - https://ok.vercel.app\n`;
    const { config } = parseProplanConfig(yaml);
    expect(config?.deployProdUrls).toEqual([{ url: 'https://ok.vercel.app', platform: null }]);
  });
});

describe('mergeProplanConfig + serializeProplanConfig', () => {
  it('mescla entidade preservando as demais', () => {
    const base = { mapping: { architecture: 'docs/a.md' }, deployProdUrls: [] };
    const merged = mergeProplanConfig(base, 'deploy', null);
    expect(merged.mapping.architecture).toBe('docs/a.md');
    expect(merged.mapping.deploy).toBeNull();
  });

  it('mesclar mapeamento NÃO apaga deployProdUrls declaradas', () => {
    const base = {
      mapping: { architecture: 'docs/a.md' },
      deployProdUrls: [{ url: 'https://a.netlify.app', platform: null }],
    };
    const merged = mergeProplanConfig(base, 'design', 'docs/d.md');
    expect(merged.deployProdUrls).toEqual([{ url: 'https://a.netlify.app', platform: null }]);
  });

  it('serializa round-trip parseável com proplan: v2', () => {
    const cfg = { mapping: { testing: 'docs/qa/e.md', deploy: null }, deployProdUrls: [] };
    const yaml = serializeProplanConfig(cfg);
    expect(yaml).toContain('proplan: v2');
    const { config } = parseProplanConfig(yaml);
    expect(config?.mapping.testing).toBe('docs/qa/e.md');
    expect(config?.mapping.deploy).toBeNull();
  });

  it('round-trip preserva prodUrls (string e objeto)', () => {
    const cfg = {
      mapping: {},
      deployProdUrls: [
        { url: 'https://a.netlify.app', platform: null },
        { url: 'https://own.com.br', platform: 'railway' },
      ],
    };
    const { config } = parseProplanConfig(serializeProplanConfig(cfg));
    expect(config?.deployProdUrls).toEqual(cfg.deployProdUrls);
  });
});
