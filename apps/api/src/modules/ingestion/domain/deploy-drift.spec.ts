import {
  extractDeclaredPlatforms,
  platformsFromRepoConfig,
  platformFromDeclaredUrl,
  reconcile,
  DeploySignal,
} from './deploy-drift';

const AT = '2026-07-14T12:00:00.000Z';

function sig(
  source: DeploySignal['source'],
  platforms: string[],
  evidenceRef = 'x',
): DeploySignal {
  return { source, platforms, observedAt: AT, evidenceRef };
}

describe('extractDeclaredPlatforms', () => {
  it('extrai plataformas nomeadas no texto (case-insensitive, word-boundary)', () => {
    const md = 'O front roda na Netlify e a API no Railway.';
    expect(extractDeclaredPlatforms(md).sort()).toEqual(['netlify', 'railway']);
  });

  it('doc que silencia sobre host → vazio', () => {
    const md = 'Configuramos o Supabase e as variáveis de ambiente.';
    expect(extractDeclaredPlatforms(md)).toEqual([]);
  });

  it('menção casual "migramos da Vercel" NÃO deve inflar o confronto — mas é extraída como presença de plataforma', () => {
    // O texto cita Vercel; a extração é literal (a spec resolve o "casual" no
    // reconcile: menção única não basta para `discordam` se nenhuma outra fonte
    // aponta algo diferente). Aqui só garantimos determinismo da extração.
    expect(extractDeclaredPlatforms('Migramos da Vercel para outra coisa.')).toEqual(['vercel']);
  });

  it('não casa substring dentro de palavra (ex.: "flyer" não vira fly.io)', () => {
    expect(extractDeclaredPlatforms('Distribua o flyer para o cliente.')).toEqual([]);
  });

  it('deduplica plataforma citada várias vezes', () => {
    expect(extractDeclaredPlatforms('Vercel aqui, Vercel ali, VERCEL acolá.')).toEqual(['vercel']);
  });
});

describe('platformsFromRepoConfig', () => {
  it('vercel.json → vercel', () => {
    const found = platformsFromRepoConfig(['vercel.json', 'package.json']);
    expect(found).toEqual([{ platform: 'vercel', file: 'vercel.json' }]);
  });

  it('netlify.toml + railway.json → duas plataformas', () => {
    const found = platformsFromRepoConfig(['netlify.toml', 'railway.json', 'README.md']);
    expect(found.map((f) => f.platform).sort()).toEqual(['netlify', 'railway']);
  });

  it('lista sem config de deploy → vazio', () => {
    expect(platformsFromRepoConfig(['README.md', 'src/index.ts'])).toEqual([]);
  });

  it('Procfile → heroku', () => {
    expect(platformsFromRepoConfig(['Procfile']).map((f) => f.platform)).toEqual(['heroku']);
  });
});

describe('platformFromDeclaredUrl', () => {
  it('*.netlify.app → netlify', () => {
    expect(platformFromDeclaredUrl('https://escola-erp.netlify.app')).toBe('netlify');
  });

  it('*.up.railway.app → railway', () => {
    expect(
      platformFromDeclaredUrl('https://escola-api-production-26c1.up.railway.app'),
    ).toBe('railway');
  });

  it('*.vercel.app → vercel', () => {
    expect(platformFromDeclaredUrl('https://foo.vercel.app')).toBe('vercel');
  });

  it('*.onrender.com → render · *.fly.dev → fly · *.pages.dev → cloudflare · *.herokuapp.com → heroku', () => {
    expect(platformFromDeclaredUrl('https://a.onrender.com')).toBe('render');
    expect(platformFromDeclaredUrl('https://a.fly.dev')).toBe('fly');
    expect(platformFromDeclaredUrl('https://a.pages.dev')).toBe('cloudflare');
    expect(platformFromDeclaredUrl('https://a.herokuapp.com')).toBe('heroku');
  });

  it('domínio próprio → null (não chuta plataforma)', () => {
    expect(platformFromDeclaredUrl('https://gestao.epgtrindade.com.br')).toBeNull();
  });

  it('URL inválida → null', () => {
    expect(platformFromDeclaredUrl('não é url')).toBeNull();
  });

  it('não é enganado por sufixo forjado no caminho (netlify.app no path, host próprio)', () => {
    expect(platformFromDeclaredUrl('https://evil.com/netlify.app')).toBeNull();
  });
});

describe('reconcile — os 5 estados', () => {
  it('concordam: todas as fontes presentes apontam o mesmo → silencioso', () => {
    const v = reconcile([
      sig('doc', ['vercel']),
      sig('repoConfig', ['vercel']),
      sig('githubDeployments', ['vercel']),
      sig('declaredUrl', ['vercel']),
    ]);
    expect(v.state).toBe('concordam');
  });

  it('discordam: duas fontes presentes apontam plataformas diferentes', () => {
    const v = reconcile([
      sig('repoConfig', ['vercel']),
      sig('declaredUrl', ['netlify']),
    ]);
    expect(v.state).toBe('discordam');
  });

  it('caso rrb-escola real: config+GitHub Vercel × URL declarada Netlify+Railway → discordam', () => {
    const v = reconcile([
      sig('repoConfig', ['vercel']),
      sig('githubDeployments', ['vercel']),
      sig('declaredUrl', ['netlify', 'railway']),
    ]);
    expect(v.state).toBe('discordam');
  });

  it('so_github_side: sinal de config/GitHub mas nenhuma URL declarada → pede URL, não crava', () => {
    const v = reconcile([
      sig('repoConfig', ['vercel']),
      sig('githubDeployments', ['vercel']),
    ]);
    expect(v.state).toBe('so_github_side');
  });

  it('omissa: deployments no GitHub e nenhuma doc de deploy', () => {
    const v = reconcile([sig('githubDeployments', ['vercel'])]);
    expect(v.state).toBe('omissa');
  });

  it('silencio: nada aponta nada, sem deployments → silencioso', () => {
    const v = reconcile([]);
    expect(v.state).toBe('silencio');
  });

  it('silencio: fontes presentes mas todas vazias (silenciaram) → silencio', () => {
    const v = reconcile([sig('doc', []), sig('repoConfig', [])]);
    expect(v.state).toBe('silencio');
  });

  it('menção casual: só o doc cita Vercel e nada mais aponta → NÃO é discordam (é so_github_side/omissa conforme sinal), nunca falso discordam', () => {
    // doc sozinho com uma plataforma, sem outra fonte divergente → não há duas
    // fontes apontando plataformas diferentes → não pode ser `discordam`.
    const v = reconcile([sig('doc', ['vercel'])]);
    expect(v.state).not.toBe('discordam');
  });

  it('domínio próprio (declaredUrl vazio pós-parse) não gera falso discordam contra config', () => {
    // URL própria → platform null → declaredUrl entra com platforms [] → não confronta.
    const v = reconcile([
      sig('repoConfig', ['vercel']),
      sig('declaredUrl', []),
    ]);
    expect(v.state).not.toBe('discordam');
  });

  it('preserva os sinais de entrada no veredito para a UI', () => {
    const signals = [sig('repoConfig', ['vercel']), sig('declaredUrl', ['netlify'])];
    const v = reconcile(signals);
    expect(v.signals).toEqual(signals);
  });
});
