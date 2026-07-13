import { parse, stringify } from 'yaml';
import { Entity, ENTITIES } from './entity';

/** Mapeamento explícito do usuário (ADR-014). null = ausência confirmada. */
export interface ProplanConfig {
  mapping: Partial<Record<Entity, string | null>>;
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
    const raw = parse(yaml) as { mapping?: Record<string, unknown> } | null;
    const rawMapping = raw?.mapping ?? {};
    const mapping: Partial<Record<Entity, string | null>> = {};
    for (const [k, v] of Object.entries(rawMapping)) {
      if (!isEntity(k)) continue;
      if (v === null) mapping[k] = null;
      else if (typeof v === 'string') mapping[k] = v;
    }
    return { config: { mapping }, invalid: false };
  } catch {
    return { config: null, invalid: true };
  }
}

/** Mescla uma entidade no config (imutável), preservando as demais. */
export function mergeProplanConfig(
  base: ProplanConfig | null,
  entity: Entity,
  path: string | null,
): ProplanConfig {
  const mapping = { ...(base?.mapping ?? {}) };
  mapping[entity] = path;
  return { mapping };
}

/** Reescreve o arquivo inteiro (gerador determinístico), `proplan: v2`. */
export function serializeProplanConfig(cfg: ProplanConfig): string {
  const header = '# gerado/atualizado pelo ProPlan (ADR-014) — mapeamento de documentos\n';
  const body = stringify({ proplan: 'v2', mapping: cfg.mapping });
  return header + body;
}
