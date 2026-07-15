export interface DeployEnv {
  env: string;
  /** SPEC-017: componente (web, API, banco, cache…). Ausente → monolito implícito. */
  componente?: string;
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

function splitRow(line: string): string[] {
  return line.trim().split('|').slice(1, -1).map(cell);
}

function isSeparator(cells: string[]): boolean {
  return cells.every((c) => /^:?-+:?$/.test(c));
}

/** Coluna → índice, casando pelo nome do header (acento/caixa-insensível). */
type ColMap = { env: number; componente: number; status: number; platform: number; url: number };

function matchHeader(cells: string[]): ColMap | null {
  const find = (re: RegExp) => cells.findIndex((c) => re.test(c.trim()));
  const env = find(/^ambiente$/i);
  const status = find(/^status$/i);
  const platform = find(/^plataforma$/i);
  const url = find(/^url$/i);
  // Header válido exige ao menos Ambiente + Status + Plataforma reconhecidos.
  if (env < 0 || status < 0 || platform < 0) return null;
  return { env, componente: find(/^componente$/i), status, platform, url };
}

/**
 * Parseia a tabela markdown de Deploy. **Header-aware** (SPEC-017): mapeia as
 * colunas pelos nomes do cabeçalho, não por posição fixa — assim o formato de 4
 * colunas (sem `Componente`) continua parseando (compat v1) e o de 5 colunas
 * (com `Componente`) ganha o eixo componente. Célula '—' vira null na URL.
 * Sem cabeçalho reconhecível → lista vazia.
 */
export function parseDeploy(content: string): DeployEnv[] {
  const lines = content.split('\n');
  const out: DeployEnv[] = [];
  let cols: ColMap | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = splitRow(t);
    if (cells.length < 3) continue;
    if (!cols) {
      cols = matchHeader(cells);
      continue; // linha de cabeçalho não vira dado
    }
    if (isSeparator(cells)) continue;
    const at = (i: number) => (i >= 0 ? cells[i] ?? '' : '');
    const componente = at(cols.componente).trim();
    out.push({
      env: at(cols.env),
      ...(componente ? { componente } : {}),
      status: at(cols.status),
      platform: at(cols.platform),
      url: urlOrNull(at(cols.url)),
    });
  }
  return out;
}
