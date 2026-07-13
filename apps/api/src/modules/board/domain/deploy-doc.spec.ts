import { parseDeploy } from './deploy-doc';

describe('parseDeploy', () => {
  it('parseia a tabela de ambientes do CONVENTION.md', () => {
    const content = `# Deploy\n\n## Ambientes\n| Ambiente | Status | Plataforma | URL |\n|---|---|---|---|\n| produção | ativo | Vercel + Supabase | https://app.exemplo.com |\n| homolog | inativo | — | — |\n`;
    const envs = parseDeploy(content);
    expect(envs).toHaveLength(2);
    expect(envs[0]).toEqual({ env: 'produção', status: 'ativo', platform: 'Vercel + Supabase', url: 'https://app.exemplo.com' });
    expect(envs[1].url).toBeNull(); // '—' vira null
  });

  it('sem tabela → lista vazia', () => {
    expect(parseDeploy('# Deploy\n\nSem ambientes ainda.')).toEqual([]);
  });
});
