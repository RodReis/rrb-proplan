import { matchAlias } from './alias-table';
import { Entity, ENTITIES, Resolution } from './entity';
import { ProplanConfig } from './proplan-config';

export interface DocInput {
  path: string;
  isConventional: boolean;
}
export interface ResolverInput {
  docs: DocInput[];
  config: ProplanConfig | null;
}

/** Caminho canônico (nível 1) de cada entidade. */
const CONVENTION_PATH: Record<Entity, string> = {
  architecture: 'docs/ARCHITECTURE.md',
  decisions: 'docs/DECISIONS.md',
  design: 'docs/DESIGN.md',
  testing: 'docs/TESTING.md',
  deploy: 'docs/DEPLOY.md',
  skills: 'CLAUDE.md',
};

function absent(entity: Entity, source: 'absent' | 'config'): Resolution {
  return { entity, level: 4, source, path: null, paths: [], confidence: source === 'config' ? 1 : 0 };
}

/** Arquivos sob um diretório (prefixo `dir/`). `dir` pode ou não ter barra final. */
function under(docs: DocInput[], dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : dir + '/';
  return docs.filter((d) => d.path.startsWith(prefix)).map((d) => d.path).sort();
}

/**
 * Resolve as 6 entidades pela escada do ADR-014 (config → convenção → alias →
 * ausente). Puro: recebe docs + config já parseados, devolve Resolution[].
 */
export function resolveDocuments(input: ResolverInput): Resolution[] {
  const { docs, config } = input;

  return ENTITIES.map((entity) => resolveOne(entity, docs, config));
}

function resolveOne(entity: Entity, docs: DocInput[], config: ProplanConfig | null): Resolution {
  // 1. Config vence tudo.
  const mapped = config?.mapping?.[entity];
  if (mapped !== undefined) {
    if (mapped === null) return absent(entity, 'config');
    if (mapped.endsWith('/')) {
      const coll = under(docs, mapped);
      return { entity, level: 2, source: 'config', path: null, paths: coll, confidence: 1 };
    }
    return { entity, level: 1, source: 'config', path: mapped, paths: [], confidence: 1 };
  }

  // 2. Convenção: path exato COM frontmatter proplan:v1.
  const conv = docs.find((d) => d.path === CONVENTION_PATH[entity] && d.isConventional);
  if (conv) {
    return { entity, level: 1, source: 'convention', path: conv.path, paths: [], confidence: 1 };
  }

  // 3. Alias: nome inteiro ou diretório (não-ganancioso).
  const aliasHits = docs.filter((d) => matchAlias(d.path) === entity).map((d) => d.path);
  if (aliasHits.length > 0) {
    // Coleção quando 2+ arquivos casam (adr/, docs/qa/) ou skills; senão arquivo único.
    if (aliasHits.length > 1 || entity === 'decisions' || entity === 'skills') {
      return { entity, level: 2, source: 'alias', path: null, paths: aliasHits.sort(), confidence: 0.8 };
    }
    return { entity, level: 2, source: 'alias', path: aliasHits[0], paths: [], confidence: 0.8 };
  }

  // 4. Ausente.
  return absent(entity, 'absent');
}
