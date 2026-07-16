/**
 * Tintas por etapa do Kanban e cores de prioridade (DESIGN.md §4.3).
 *
 * Cor semântica que depende de *dado* (etapa/prioridade), não de estado de CSS,
 * não cabe em custom property por tema — vive aqui como mapa TS, conforme
 * DESIGN.md §12. É a única exceção à regra "componente só usa var(--token)".
 */
import type { Theme } from './theme';

/** As 6 colunas fixas do CONVENTION.md; `descartado` é trilho, sem tinta. */
export type Stage = 'backlog' | 'todo' | 'doing' | 'done' | 'finalizado';

/** Cor plena da etapa: ponto do header, contador, borda de foco. */
const STAGE_COLOR: Record<Theme, Record<Stage, string>> = {
  carbono: {
    backlog: '#8a90a0',
    todo: '#7ea6d8',
    doing: '#d9a05b',
    done: '#a596d8',
    finalizado: '#4ade80',
  },
  claro: {
    backlog: '#6b7280',
    todo: '#3f6aa5',
    doing: '#96691c',
    done: '#6b5aa8',
    finalizado: '#15803d',
  },
};

/** Tinta de fundo do card (§4.3): a cor da etapa a ~10%. */
const STAGE_TINT: Record<Theme, Record<Stage, string>> = {
  carbono: {
    backlog: 'rgba(138,144,160,.10)',
    todo: 'rgba(126,166,216,.10)',
    doing: 'rgba(217,160,91,.10)',
    done: 'rgba(165,150,216,.10)',
    finalizado: 'rgba(74,222,128,.10)',
  },
  claro: {
    backlog: 'rgba(107,114,128,.09)',
    todo: 'rgba(63,106,165,.09)',
    doing: 'rgba(150,105,28,.09)',
    done: 'rgba(107,90,168,.09)',
    finalizado: 'rgba(21,128,61,.09)',
  },
};

export type Priority = 'alta' | 'media' | 'baixa';

/** Borda esquerda 3px do card (§4.3). */
const PRIORITY_COLOR: Record<Theme, Record<Priority, string>> = {
  carbono: { alta: '#e08a80', media: '#d9a05b', baixa: '#3a3d45' },
  claro: { alta: '#c65a4e', media: '#c29a4a', baixa: '#c2c2be' },
};

export function stageColor(theme: Theme, stage: Stage): string {
  return STAGE_COLOR[theme][stage];
}

export function stageTint(theme: Theme, stage: Stage): string {
  return STAGE_TINT[theme][stage];
}

export function priorityColor(theme: Theme, priority: Priority): string {
  return PRIORITY_COLOR[theme][priority];
}

/**
 * Estilo do card: `--surface2` + camada de tinta por cima (§4.3 — a tinta é
 * background-image, não background-color, para não perder a superfície base).
 */
export function stageCardStyle(theme: Theme, stage: Stage): React.CSSProperties {
  const tint = stageTint(theme, stage);
  return {
    backgroundColor: 'var(--surface2)',
    backgroundImage: `linear-gradient(${tint}, ${tint})`,
  };
}
