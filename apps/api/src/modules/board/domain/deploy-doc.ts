export interface DeployEnv {
  env: string;
  status: string;
  platform: string;
  url: string | null;
}

function cell(s: string): string {
  return s.trim();
}

function urlOrNull(s: string): string | null {
  const v = s.trim();
  return v === '' || v === '—' || v === '-' ? null : v;
}

/**
 * Parseia a tabela markdown `| Ambiente | Status | Plataforma | URL |`. Ignora a
 * linha de cabeçalho e a de separação. Célula '—' vira null na URL.
 */
export function parseDeploy(content: string): DeployEnv[] {
  const lines = content.split('\n');
  const out: DeployEnv[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map(cell);
    if (cells.length < 4) continue;
    const [env, status, platform, url] = cells;
    // Pular cabeçalho e separador.
    if (/^ambiente$/i.test(env) || /^-+$/.test(env)) continue;
    out.push({ env, status, platform, url: urlOrNull(url) });
  }
  return out;
}
