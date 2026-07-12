import { useState } from 'react';
import { api, Repo } from '../../lib/api';
import { DocumentsTab } from './DocumentsTab';
import { CURRENT_SLICE, WORKSPACE_TABS } from './tabs';

interface Props {
  project: Repo; // repo gerenciado (tem managedProjectId garantido)
}

export function Workspace({ project }: Props) {
  const projectId = project.managedProjectId!;
  const [activeTab, setActiveTab] = useState('documents');
  const [syncNonce, setSyncNonce] = useState(0);
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await api.sync(projectId);
      setSyncNonce((n) => n + 1); // sinaliza a aba para recarregar + repolar
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 pt-5">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {project.owner}/{project.name}
            </h1>
            <a
              href={`https://github.com/${project.owner}/${project.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-muted underline-offset-2 hover:text-brand hover:underline"
            >
              Abrir no GitHub ↗
            </a>
          </div>
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition-all duration-150 hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        </div>

        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {WORKSPACE_TABS.map((tab) => {
            const enabled = tab.enabledIn === CURRENT_SLICE;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => enabled && setActiveTab(tab.id)}
                disabled={!enabled}
                title={enabled ? undefined : `Fatia ${tab.enabledIn}`}
                className={
                  'shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors duration-200 ' +
                  (isActive
                    ? 'bg-brand/10 font-semibold text-brand'
                    : enabled
                      ? 'text-text hover:bg-bg'
                      : 'cursor-not-allowed text-text-muted/50')
                }
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1">
        {activeTab === 'documents' && (
          <DocumentsTab projectId={projectId} syncNonce={syncNonce} />
        )}
      </div>
    </div>
  );
}
