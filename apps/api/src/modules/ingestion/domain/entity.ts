/** As 6 entidades canônicas resolvidas nesta fatia (nível 3/IA é Fatia 7). */
export type Entity =
  | 'architecture'
  | 'decisions'
  | 'design'
  | 'testing'
  | 'deploy'
  | 'skills';

export const ENTITIES: Entity[] = [
  'architecture',
  'decisions',
  'design',
  'testing',
  'deploy',
  'skills',
];

/** Origem da resolução na escada do ADR-014. */
export type Source = 'convention' | 'alias' | 'config' | 'absent';

/** Resultado da resolução de uma entidade. Nível 3 (IA) não existe nesta fatia. */
export interface Resolution {
  entity: Entity;
  level: 1 | 2 | 4;
  source: Source;
  /** Arquivo único resolvido, ou null (coleção ou ausente). */
  path: string | null;
  /** Coleção de arquivos (ex.: adr/*.md); [] quando é arquivo único ou ausente. */
  paths: string[];
  /** 1.0 convenção · 0.8 alias · 1.0 config · 0 ausente. */
  confidence: number;
}
