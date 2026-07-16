import type { Project } from '../../../lib/api';

/**
 * Alerta exibido no item do combo (SPEC-020 §3).
 *
 * O item mostra **no máximo um** badge: o mais grave. Os sinais que hoje se
 * acumulam na lista de projetos passam a caber num só — a lista morreu com o
 * shell antigo, e um item de dropdown não comporta quatro badges.
 */
export type AlertKind = 'sem-instalacao' | 'deploy-divergente' | 'deploy-duvida' | 'importar';

export interface Alert {
  kind: AlertKind;
  label: string;
  title: string;
}

/** Ordem de gravidade da spec — o primeiro que casar vence. */
const RULES: ReadonlyArray<{ kind: AlertKind; when: (p: Project) => boolean; label: string; title: string }> = [
  {
    kind: 'sem-instalacao',
    when: (p) => p.installationStatus === 'missing',
    label: 'sem instalação',
    title: 'App removido deste repositório — escritas desabilitadas',
  },
  {
    kind: 'deploy-divergente',
    when: (p) => p.deployVerdict === 'discordam',
    label: 'deploy divergente',
    title: 'As fontes de deploy discordam sobre a plataforma — ver aba Deploy',
  },
  {
    kind: 'deploy-duvida',
    when: (p) => p.deployVerdict === 'so_github_side' || p.deployVerdict === 'omissa',
    label: 'deploy?',
    title: 'Sinal de deploy no GitHub sem fonte fresca ou sem doc — ver aba Deploy',
  },
  {
    kind: 'importar',
    when: (p) => p.needsIssueImport,
    label: 'importar',
    title: 'Tem um STATUS.md legado — importar como Issues no Kanban',
  },
];

/** O alerta mais grave do projeto, ou null se não houver nenhum. */
export function projectAlert(project: Project): Alert | null {
  const hit = RULES.find((r) => r.when(project));
  return hit ? { kind: hit.kind, label: hit.label, title: hit.title } : null;
}

/**
 * Cor do badge por alerta. `sem instalação` e `deploy divergente` são os graves
 * (vermelho dessaturado); os outros dois são atenção (âmbar) — §4.2.
 */
export function alertColor(kind: AlertKind): string {
  return kind === 'sem-instalacao' || kind === 'deploy-divergente'
    ? 'var(--error)'
    : 'var(--warning)';
}
