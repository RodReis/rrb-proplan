import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../../lib/api';
import { sortByLastAccess } from '../../../lib/lastAccess';
import { alertColor, projectAlert } from './projectAlert';

interface Props {
  project: Project;
  projects: Project[];
  onSelectProject: (id: string) => void;
  onBackToCatalog: () => void;
}

/**
 * Combo de workspace (SPEC-020 §1) — topo da sidebar.
 *
 * A troca de projeto é ato deliberado: a sidebar serve ao projeto aberto, não à
 * troca. O combo não protege nada (os projetos seguem a um clique) — entrega
 * foco. Proteção real é a Fatia 8.
 */
export function WorkspaceCombo({
  project,
  projects,
  onSelectProject,
  onBackToCatalog,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou no Esc (§11: Esc sempre fecha).
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

  const ordered = sortByLastAccess(projects);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left transition-colors duration-150 hover:bg-card"
      >
        <span
          aria-hidden
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] text-sm font-bold"
          style={{ background: 'var(--brand-gradient)', color: 'var(--brand-fg)' }}
        >
          P
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            Workspace
          </span>
          <span className="block truncate text-[13px] font-semibold text-text">
            {project.name}
          </span>
        </span>
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={
            'shrink-0 text-dim transition-transform duration-150 ' +
            (open ? 'rotate-180' : '')
          }
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="anim-dropIn absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-[14px] border border-border2 bg-pop"
          style={{ boxShadow: '0 24px 60px var(--shadow)' }}
        >
          <div className="px-3 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            Projetos gerenciados
          </div>
          <ul className="max-h-[320px] overflow-y-auto p-1.5">
            {ordered.map((p) => (
              <ComboItem
                key={p.id}
                project={p}
                active={p.id === project.id}
                onSelect={() => {
                  setOpen(false);
                  if (p.id !== project.id) onSelectProject(p.id);
                }}
              />
            ))}
          </ul>
          <button
            onClick={onBackToCatalog}
            className="w-full border-t border-border px-3 py-2.5 text-left text-xs text-muted transition-colors duration-150 hover:bg-card hover:text-text"
          >
            ← Voltar ao catálogo
          </button>
        </div>
      )}
    </div>
  );
}

function ComboItem({
  project,
  active,
  onSelect,
}: {
  project: Project;
  active: boolean;
  onSelect: () => void;
}) {
  const alert = projectAlert(project);
  // Ponto de estado de sync: verde quando já sincronizou, neutro enquanto não.
  const synced = project.lastSyncAt !== null;

  return (
    <li>
      <button
        role="option"
        aria-selected={active}
        onClick={onSelect}
        className={
          'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left transition-colors duration-150 ' +
          (active ? 'bg-card' : 'hover:bg-card')
        }
      >
        <span
          aria-hidden
          title={synced ? 'Sincronizado' : 'Nunca sincronizado'}
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: synced ? 'var(--success)' : 'var(--dimmer)' }}
        />
        <span className="min-w-0 flex-1">
          <span
            className={
              'block truncate text-[12.5px] ' +
              (active ? 'font-semibold text-text' : 'text-text2')
            }
          >
            {project.name}
          </span>
          <span className="block truncate text-[11px] text-dim">{project.owner}</span>
        </span>
        {alert && (
          <span
            title={alert.title}
            className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.06em]"
            style={{
              color: alertColor(alert.kind),
              background: `color-mix(in srgb, ${alertColor(alert.kind)} 14%, transparent)`,
            }}
          >
            {alert.label}
          </span>
        )}
      </button>
    </li>
  );
}
