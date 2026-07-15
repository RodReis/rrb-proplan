import { parseDeploy } from './deploy-doc';

describe('parseDeploy', () => {
  it('parseia a tabela de ambientes do CONVENTION.md', () => {
    const content = `# Deploy\n\n## Ambientes\n| Ambiente | Status | Plataforma | URL |\n|---|---|---|---|\n| produção | ativo | Vercel + Supabase | https://app.exemplo.com |\n| homolog | inativo | — | — |\n`;
    const envs = parseDeploy(content);
    expect(envs).toHaveLength(2);
    expect(envs[0]).toEqual({ env: 'produção', status: 'ativo', platform: 'Vercel + Supabase', url: 'https://app.exemplo.com' });
    expect(envs[1].url).toBeNull(); // '—' vira null
  });

  it('formato de 4 colunas não traz componente (monolito implícito)', () => {
    const content = `| Ambiente | Status | Plataforma | URL |\n|---|---|---|---|\n| produção | ativo | Railway | https://api.exemplo.com |\n`;
    expect(parseDeploy(content)[0]).not.toHaveProperty('componente');
  });

  it('sem tabela → lista vazia', () => {
    expect(parseDeploy('# Deploy\n\nSem ambientes ainda.')).toEqual([]);
  });

  // SPEC-017 — eixo componente (5 colunas).
  it('parseia 5 colunas com Componente: caso rrb-escola (web/Netlify + API/Railway, 1 ambiente)', () => {
    const content = `## Ambientes
| Ambiente | Componente | Status | Plataforma | URL |
|---|---|---|---|---|
| produção | web | ativo | Netlify | https://escola-erp.netlify.app |
| produção | API | ativo | Railway | https://escola-api-production-26c1.up.railway.app |
| produção | banco | ativo | Supabase | — |
`;
    const envs = parseDeploy(content);
    expect(envs).toHaveLength(3);
    expect(envs[0]).toEqual({ env: 'produção', componente: 'web', status: 'ativo', platform: 'Netlify', url: 'https://escola-erp.netlify.app' });
    expect(envs[1].componente).toBe('API');
    expect(envs[2].url).toBeNull();
  });

  it('infra de apoio tem onde ser escrita: caso rrb-organize (app + 2× redis), sem colar provedores num +', () => {
    const content = `| Ambiente | Componente | Status | Plataforma | URL |
|---|---|---|---|---|
| produção | API | ativo | Railway | — |
| produção | cache (redis-volume) | ativo | Railway | — |
| produção | cache (redis-volume-bgPY) | ativo | Railway | — |
`;
    const envs = parseDeploy(content);
    expect(envs.map((e) => e.componente)).toEqual(['API', 'cache (redis-volume)', 'cache (redis-volume-bgPY)']);
  });

  it('colunas em ordem trocada: mapeia por nome, não por posição', () => {
    const content = `| Componente | Ambiente | Plataforma | Status | URL |
|---|---|---|---|---|
| web | produção | Netlify | ativo | https://x.netlify.app |
`;
    expect(parseDeploy(content)[0]).toEqual({ env: 'produção', componente: 'web', status: 'ativo', platform: 'Netlify', url: 'https://x.netlify.app' });
  });

  it('Componente vazio numa linha → tratada como sem componente', () => {
    const content = `| Ambiente | Componente | Status | Plataforma | URL |
|---|---|---|---|---|
| produção |  | ativo | Railway | — |
`;
    expect(parseDeploy(content)[0]).not.toHaveProperty('componente');
  });
});
