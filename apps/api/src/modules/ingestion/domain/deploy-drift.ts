/**
 * Drift de deploy (SPEC-013 v2.1) — confronto de fontes, sem coroar verdade.
 *
 * Domínio PURO: sem banco, sem rede, sem IA. As 4 fontes chegam já coletadas
 * (o sync-job faz a coleta); aqui só extraímos plataformas por texto/sufixo e
 * reconciliamos. O produto nunca diz "roda em X" — diz "a fonte Y aponta X".
 */

/** Plataformas conhecidas — nome canônico em minúsculas. */
const KNOWN_PLATFORMS = [
  'vercel',
  'netlify',
  'railway',
  'render',
  'fly',
  'cloudflare',
  'heroku',
] as const;

/** Sufixos de domínio → plataforma (parse de string, sem HTTP). */
const DOMAIN_SUFFIXES: { suffix: string; platform: string }[] = [
  { suffix: '.netlify.app', platform: 'netlify' },
  { suffix: '.up.railway.app', platform: 'railway' },
  { suffix: '.railway.app', platform: 'railway' },
  { suffix: '.vercel.app', platform: 'vercel' },
  { suffix: '.onrender.com', platform: 'render' },
  { suffix: '.fly.dev', platform: 'fly' },
  { suffix: '.pages.dev', platform: 'cloudflare' },
  { suffix: '.workers.dev', platform: 'cloudflare' },
  { suffix: '.herokuapp.com', platform: 'heroku' },
];

/** Arquivos de config no repo → plataforma (declaração de intenção). */
const CONFIG_FILES: { file: string; platform: string }[] = [
  { file: 'vercel.json', platform: 'vercel' },
  { file: 'netlify.toml', platform: 'netlify' },
  { file: 'railway.json', platform: 'railway' },
  { file: 'railway.toml', platform: 'railway' },
  { file: 'render.yaml', platform: 'render' },
  { file: 'fly.toml', platform: 'fly' },
  { file: 'Procfile', platform: 'heroku' },
];

export type DeploySource = 'doc' | 'repoConfig' | 'githubDeployments' | 'declaredUrl';

/**
 * Modo pelo qual a plataforma de `declaredUrl` foi obtida (SPEC-013.6):
 *  - `string`: parse do sufixo de domínio, sem rede (o da Fatia 13).
 *  - `probe`: GET HTTP ao vivo, fingerprint de headers (esta fatia).
 *  - `bloqueada_por_seguranca`: destino não-público — não sondado (ADR-018).
 */
export type DeclaredUrlMode = 'string' | 'probe' | 'bloqueada_por_seguranca';

export interface DeploySignal {
  source: DeploySource;
  /** Plataformas que a fonte aponta. Vazio = a fonte silenciou/é domínio próprio. */
  platforms: string[];
  observedAt: string;
  /** Referência da evidência (path do doc, nome do arquivo, URL, "deployments"). */
  evidenceRef: string;
  /** Só para source `declaredUrl` (SPEC-013.6): como a plataforma foi obtida. */
  mode?: DeclaredUrlMode;
}

export type DeployVerdictState =
  | 'concordam'
  | 'discordam'
  | 'so_github_side'
  | 'omissa'
  | 'silencio';

export interface DeployVerdict {
  state: DeployVerdictState;
  signals: DeploySignal[];
}

/** Extrai plataformas nomeadas num texto (word-boundary, case-insensitive, dedup). */
export function extractDeclaredPlatforms(markdown: string): string[] {
  const found = new Set<string>();
  for (const p of KNOWN_PLATFORMS) {
    const re = new RegExp(`\\b${p}\\b`, 'i');
    if (re.test(markdown)) found.add(p);
  }
  return [...found];
}

/** Plataformas por presença de arquivo de config na raiz (declaração de intenção). */
export function platformsFromRepoConfig(
  rootFileList: string[],
): { platform: string; file: string }[] {
  const set = new Set(rootFileList);
  const out: { platform: string; file: string }[] = [];
  for (const { file, platform } of CONFIG_FILES) {
    if (set.has(file)) out.push({ platform, file });
  }
  return out;
}

/**
 * Plataforma a partir do sufixo de domínio de uma URL declarada.
 * Domínio próprio (sufixo não reconhecido) → null. Nunca chuta.
 */
export function platformFromDeclaredUrl(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const { suffix, platform } of DOMAIN_SUFFIXES) {
    if (host.endsWith(suffix)) return platform;
  }
  return null;
}

/**
 * Reconcilia as 4 fontes num veredito. Não coroa nenhuma fonte como verdade —
 * só classifica o *padrão de concordância*. A UI mostra os sinais.
 */
export function reconcile(signals: DeploySignal[]): DeployVerdict {
  const platformsOf = (s: DeploySource): string[] =>
    signals.filter((x) => x.source === s).flatMap((x) => x.platforms);

  const hasFreshDeclaredPlatform = platformsOf('declaredUrl').length > 0;
  const hasConfig = platformsOf('repoConfig').length > 0;
  const hasDeployments = platformsOf('githubDeployments').length > 0;
  const hasDoc = platformsOf('doc').length > 0;

  // Fontes "com voz" (apontaram ao menos uma plataforma).
  const votingSources = signals.filter((s) => s.platforms.length > 0);

  // discordam: existe um par de fontes com voz cujos conjuntos de plataformas
  // difiram. Uma menção casual isolada (só o doc fala) não pode disparar isto —
  // não há par divergente.
  if (pairwiseDisagree(votingSources)) return { state: 'discordam', signals };

  // Ninguém apontou plataforma alguma.
  if (votingSources.length === 0) {
    // Deployments registrados mas nenhuma doc de deploy → mentir por omissão.
    if (hasDeployments && !hasDoc) return { state: 'omissa', signals };
    return { state: 'silencio', signals };
  }

  // Todas as fontes com voz concordam entre si (nenhum par divergente).
  // Se há URL declarada fresca apontando plataforma, o confronto está completo.
  if (hasFreshDeclaredPlatform) return { state: 'concordam', signals };

  // Sem URL fresca. Só há sinal GitHub-side / doc — pode estar velho.
  // omissa = deployments crus sem qualquer doc NEM config (o par de controle:
  // "em produção, zero documentação"). Havendo doc ou config, o alerta certo é
  // "declare a URL para confrontar" → so_github_side.
  if (hasDeployments && !hasDoc && !hasConfig) return { state: 'omissa', signals };
  return { state: 'so_github_side', signals };
}

/** Há um par de fontes cujos conjuntos de plataformas divergem? */
function pairwiseDisagree(voting: DeploySignal[]): boolean {
  for (let i = 0; i < voting.length; i++) {
    for (let j = i + 1; j < voting.length; j++) {
      const a = new Set(voting[i].platforms);
      const b = new Set(voting[j].platforms);
      // divergem se algum de b não está em a (conjuntos diferentes de plataformas)
      const differ = [...b].some((p) => !a.has(p)) || [...a].some((p) => !b.has(p));
      if (differ) return true;
    }
  }
  return false;
}
