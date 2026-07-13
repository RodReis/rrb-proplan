import { Entity } from './entity';

/** Normaliza para comparação: minúsculas, sem acento. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** basename sem extensão. `docs/Arch.md` → `arch`. */
function baseNoExt(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Nomes de arquivo (sem extensão) que casam cada entidade. */
const NAME_ALIASES: Record<Entity, string[]> = {
  architecture: ['architecture', 'arquitetura', 'arch', 'design-doc'],
  decisions: ['decisions', 'decisoes'],
  design: ['design', 'ui', 'styleguide'],
  testing: ['testing', 'testes', 'qa'],
  deploy: ['deploy', 'deployment', 'infra', 'runbook'],
  skills: ['claude', 'agents'],
};

/** Diretórios que, se contiverem o arquivo, casam a entidade (coleção). */
const DIR_ALIASES: Record<Entity, string[]> = {
  architecture: ['docs/arch'],
  decisions: ['adr', 'adrs', 'decisions', 'decisoes', 'docs/adr'],
  design: ['docs/design-system'],
  testing: ['docs/qa'],
  deploy: [],
  skills: ['.claude'],
};

/**
 * Resolve o path para uma entidade por alias — nome inteiro (sem extensão) OU
 * diretório, por igualdade normalizada. Nunca substring (`archive` ≠ `arch`).
 * Diretório tem prioridade sobre nome (adr/0001-x.md é decisions, não pelo nome).
 */
export function matchAlias(path: string): Entity | null {
  const p = norm(path);
  for (const entity of Object.keys(DIR_ALIASES) as Entity[]) {
    for (const dir of DIR_ALIASES[entity]) {
      if (p.startsWith(norm(dir) + '/')) return entity;
    }
  }
  const base = norm(baseNoExt(path));
  for (const entity of Object.keys(NAME_ALIASES) as Entity[]) {
    if (NAME_ALIASES[entity].includes(base)) return entity;
  }
  return null;
}
