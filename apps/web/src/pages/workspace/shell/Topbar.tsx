import type { Project } from '../../../lib/api';
import { useTheme } from '../../../theme';
import { WORKSPACE_TABS } from '../tabs';
import { ActivityPill } from './ActivityPill';

interface Props {
  project: Project;
  activeTab: string;
  syncing: boolean;
  syncNonce: number;
  activityOpen: boolean;
  onOpenActivity: () => void;
  onOpenMapping: () => void;
  onSync: () => void;
}

/**
 * Topbar 60px (SPEC-020 §2).
 *
 * Sem campo de busca global — decisão do PI em 2026-07-15: fora de requisito
 * (o protótipo o exibe; ignorar).
 */
export function Topbar({
  project,
  activeTab,
  syncing,
  syncNonce,
  activityOpen,
  onOpenActivity,
  onOpenMapping,
  onSync,
}: Props) {
  const tabLabel = WORKSPACE_TABS.find((t) => t.id === activeTab)?.label ?? activeTab;

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-panel px-5">
      <nav aria-label="Trilha" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 truncate text-[12.5px]">
          <li className="text-dim">{project.owner}</li>
          <li aria-hidden className="text-dimmer">/</li>
          <li className="truncate text-body2">{project.name}</li>
          <li aria-hidden className="text-dimmer">/</li>
          <li className="truncate font-medium text-text">{tabLabel}</li>
        </ol>
      </nav>

      <ActivityPill
        projectId={project.id}
        syncing={syncing}
        refreshNonce={syncNonce}
        drawerOpen={activityOpen}
        onOpenDrawer={onOpenActivity}
        lastSyncAt={project.lastSyncAt}
      />

      <ThemeToggle />

      <button
        onClick={onOpenMapping}
        className="h-[34px] shrink-0 rounded-[10px] border border-border2 px-3 text-xs font-semibold text-body2 transition-colors duration-150 hover:border-hoverb hover:text-text"
      >
        Mapeamento
      </button>
      <button
        onClick={onSync}
        disabled={syncing}
        className="h-[34px] w-[104px] shrink-0 rounded-[10px] bg-btnbg text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110 disabled:opacity-60"
      >
        {/* Largura fixa: o spinner ocupa o lugar do label sem pular layout (§6). */}
        {syncing ? (
          <span
            aria-label="Sincronizando"
            className="mx-auto block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
            style={{ animation: 'spin .7s linear infinite' }}
          />
        ) : (
          'Sincronizar'
        )}
      </button>
    </header>
  );
}

/** Toggle de tema (§2) — persistido em localStorage pelo ThemeProvider. */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'carbono';
  return (
    <button
      onClick={toggle}
      title={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
      aria-label={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border2 text-body2 transition-colors duration-150 hover:border-hoverb hover:text-text"
    >
      <svg
        aria-hidden
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {dark ? (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}
