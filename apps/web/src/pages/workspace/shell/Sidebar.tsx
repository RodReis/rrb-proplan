import { useEffect, useRef, useState } from 'react';
import type { Project, SessionUser } from '../../../lib/api';
import { CURRENT_SLICE } from '../tabs';
import { buildNavGroups } from './navGroups';
import { TabIcon } from './TabIcon';
import { WorkspaceCombo } from './WorkspaceCombo';

interface Props {
  user: SessionUser;
  project: Project;
  projects: Project[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  onSelectProject: (id: string) => void;
  onBackToCatalog: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

/** Sidebar 270px fixa (SPEC-020 §1). O rail de ícones morreu aqui. */
export function Sidebar({
  user,
  project,
  projects,
  activeTab,
  onSelectTab,
  onSelectProject,
  onBackToCatalog,
  onOpenSettings,
  onLogout,
}: Props) {
  const groups = buildNavGroups();

  return (
    <aside className="flex h-full w-[270px] shrink-0 flex-col border-r border-border bg-panel">
      <div className="p-3">
        <WorkspaceCombo
          project={project}
          projects={projects}
          onSelectProject={onSelectProject}
          onBackToCatalog={onBackToCatalog}
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
              {group.label}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.tabs.map((tab) => {
                const enabled = (tab.enabledIn ?? Infinity) <= CURRENT_SLICE;
                const active = tab.id === activeTab;
                return (
                  <li key={tab.id}>
                    <button
                      onClick={() => enabled && onSelectTab(tab.id)}
                      disabled={!enabled}
                      aria-current={active ? 'page' : undefined}
                      title={enabled ? undefined : `Disponível na Fatia ${tab.enabledIn}`}
                      className={
                        'relative flex w-full items-center gap-2.5 rounded-[9px] py-2 pl-3 pr-2.5 text-left text-[12.5px] transition-colors duration-150 ' +
                        (active
                          ? 'bg-card font-semibold text-text'
                          : enabled
                            ? 'text-body2 hover:bg-card hover:text-text'
                            : 'cursor-not-allowed text-dimmer')
                      }
                    >
                      {/* Item ativo: barra esquerda 2.5px em --accent (§2). */}
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-[2.5px] rounded-full"
                          style={{ background: 'var(--accent)' }}
                        />
                      )}
                      <span className={active ? 'text-accent' : undefined}>
                        <TabIcon id={tab.id} />
                      </span>
                      {tab.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <UserFooter
        user={user}
        onOpenSettings={onOpenSettings}
        onLogout={onLogout}
      />
    </aside>
  );
}

/** Rodapé de usuário (§2): avatar + nome + menu (Configurações · Sair). */
function UserFooter({
  user,
  onOpenSettings,
  onLogout,
}: {
  user: SessionUser;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative border-t border-border p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left transition-colors duration-150 hover:bg-card"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full border border-border2"
          />
        ) : (
          <span className="h-7 w-7 shrink-0 rounded-full border border-border2 bg-card" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-text2">
            {user.name ?? user.login}
          </span>
          {/* A sessão não traz e-mail (o §2 previa) — o @login identifica sem
              inventar endpoint. */}
          <span className="block truncate text-[11px] text-dim">@{user.login}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="anim-dropIn absolute bottom-full left-3 right-3 z-30 mb-1.5 overflow-hidden rounded-[12px] border border-border2 bg-pop"
          style={{ boxShadow: '0 24px 60px var(--shadow)' }}
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="w-full px-3 py-2.5 text-left text-xs text-body2 transition-colors duration-150 hover:bg-card hover:text-text"
          >
            Configurações
          </button>
          <button
            role="menuitem"
            onClick={onLogout}
            className="w-full border-t border-border px-3 py-2.5 text-left text-xs text-body2 transition-colors duration-150 hover:bg-card hover:text-text"
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
