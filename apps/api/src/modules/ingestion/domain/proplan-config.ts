import { parse, stringify } from 'yaml';
import { Entity, ENTITIES } from './entity';

/** URL de produção declarada pelo dono (ADR-013, SPEC-013). */
export interface DeclaredProdUrl {
  url: string;
  /** Plataforma declarada à mão (domínio próprio). null = deixar o parse decidir. */
  platform: string | null;
}

/** Mapeamento explícito do usuário (ADR-014). null = ausência confirmada. */
export interface ProplanConfig {
  mapping: Partial<Record<Entity, string | null>>;
  /** SPEC-013: URLs de produção declaradas (front + API podem diferir).
   *  Opcional — só o drift de deploy consome; a resolução de docs ignora. */
  deployProdUrls?: DeclaredProdUrl[];
}

function isEntity(k: string): k is Entity {
  return (ENTITIES as string[]).includes(k);
}

/**
 * Parseia `.proplan/config.yml`. Nunca lança: YAML quebrado → invalid=true e
 * config=null (o caller cai na escada e a UI avisa). Arquivo ausente (null) →
 * config=null, invalid=false.
 */
export function parseProplanConfig(yaml: string | null): {
  config: ProplanConfig | null;
  invalid: boolean;
} {
  if (yaml === null || yaml.trim() === '') return { config: null, invalid: false };
  try {
    const raw = parse(yaml) as {
      mapping?: Record<string, unknown>;
      deploy?: { prodUrls?: unknown };
    } | null;
    const rawMapping = raw?.mapping ?? {};
    const mapping: Partial<Record<Entity, string | null>> = {};
    for (const [k, v] of Object.entries(rawMapping)) {
      if (!isEntity(k)) continue;
      if (v === null) mapping[k] = null;
      else if (typeof v === 'string') mapping[k] = v;
    }
    const deployProdUrls = parseProdUrls(raw?.deploy?.prodUrls);
    return { config: { mapping, deployProdUrls }, invalid: false };
  } catch {
    return { config: null, invalid: true };
  }
}

/** Normaliza `deploy.prodUrls`: aceita string ou `{url, platform?}`, ignora lixo. */
function parseProdUrls(raw: unknown): DeclaredProdUrl[] {
  if (!Array.isArray(raw)) return [];
  const out: DeclaredProdUrl[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push({ url: item, platform: null });
    } else if (item && typeof item === 'object' && 'url' in item) {
      const obj = item as { url?: unknown; platform?: unknown };
      if (typeof obj.url !== 'string') continue;
      const platform = typeof obj.platform === 'string' ? obj.platform : null;
      out.push({ url: obj.url, platform });
    }
  }
  return out;
}

/** Mescla uma entidade no config (imutável), preservando as demais. */
export function mergeProplanConfig(
  base: ProplanConfig | null,
  entity: Entity,
  path: string | null,
): ProplanConfig {
  const mapping = { ...(base?.mapping ?? {}) };
  mapping[entity] = path;
  // Preserva as URLs declaradas do dono (SPEC-013) — salvar mapeamento não pode apagá-las.
  return { mapping, deployProdUrls: base?.deployProdUrls ?? [] };
}

/** Reescreve o arquivo inteiro (gerador determinístico), `proplan: v2`. */
export function serializeProplanConfig(cfg: ProplanConfig): string {
  const header = '# gerado/atualizado pelo ProPlan (ADR-014) — mapeamento de documentos\n';
  const doc: Record<string, unknown> = { proplan: 'v2', mapping: cfg.mapping };
  const prodUrls = cfg.deployProdUrls ?? [];
  if (prodUrls.length > 0) {
    // Serializa no formato de objeto quando há plataforma declarada; string simples senão.
    doc.deploy = {
      prodUrls: prodUrls.map((u) =>
        u.platform ? { url: u.url, platform: u.platform } : u.url,
      ),
    };
  }
  return header + stringify(doc);
}
