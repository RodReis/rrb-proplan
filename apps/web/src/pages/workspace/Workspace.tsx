import { useState } from 'react';
import { toast } from 'sonner';
import { api, Entity, Project, SessionUser, SyncRun } from '../../lib/api';
import { Settings } from '../Settings';
import { DocumentsTab } from './DocumentsTab';
import { GraphTab } from './GraphTab';
import { MappingScreen } from './MappingScreen';
import { ActivityPanel } from './ActivityPanel';
import { OverviewTab } from './OverviewTab';
import { KanbanTab } from './kanban/KanbanTab';
import { ArchitectureTab } from './tabs/ArchitectureTab';
import { ContextTab } from './tabs/ContextTab';
import { DecisionsTab } from './tabs/DecisionsTab';
import { DeployTab } from './tabs/DeployTab';
import { DesignTab } from './tabs/DesignTab';
import { SkillsTab } from './tabs/SkillsTab';
import { TestsTab } from './tabs/TestsTab';
import { HandoffTab } from './tabs/HandoffTab';
import { Sidebar } from './shell/Sidebar';
import { Topbar } from './shell/Topbar';

interface Props {
  user: SessionUser;
  project: Project;
  /** Todos os gerenciados — o combo da sidebar lista a partir daqui. */
  projects: Project[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  onSelectProject: (id: string) => void;
  onBackToCatalog: () => void;
  onLogout: () => void;
}

/**
 * Shell do workspace (SPEC-020): sidebar 270px + topbar 60px + conteúdo.
 *
 * A navegação (projeto/aba) mora na URL — este componente a recebe pronta e
 * reporta intenção via callback. O `useState` de `openProjectId`/`activeTab`
 * morreu com o shell antigo.
 */
export function Workspace({
  user,
  project,
  projects,
  activeTab,
  onSelectTab,
  onSelectProject,
  onBackToCatalog,
  onLogout,
}: Props) {
  const projectId = project.id;
  const [syncNonce, setSyncNonce] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapping, setMapping] = useState<{ open: boolean; focus: Entity | null }>({
    open: false,
    focus: null,
  });

  async function handleSync() {
    setSyncing(true);
    const toastId = toast.loading('Sincronizando…');
    try {
      const { syncRunId } = await api.sync(projectId);
      const run = await pollSyncRun(projectId, syncRunId);
      setSyncNonce((n) => n + 1);
      reportSync(run, toastId);
      // Ao concluir o sync, abre a Atividade para o resultado ficar à vista —
      // fecha o ciclo "Sincronizar → veja o que o ProPlan fez" (decisão do PI).
      setActivityOpen(true);
    } catch (err) {
      toast.error(`Falha ao sincronizar: ${err}`, { id: toastId });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar
        user={user}
        project={project}
        projects={projects}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        onSelectProject={onSelectProject}
        onBackToCatalog={onBackToCatalog}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={onLogout}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar
          project={project}
          activeTab={activeTab}
          syncing={syncing}
          syncNonce={syncNonce}
          activityOpen={activityOpen}
          onOpenActivity={() => setActivityOpen((o) => !o)}
          onOpenMapping={() => setMapping({ open: true, focus: null })}
          onSync={() => void handleSync()}
        />

        <main className="min-h-0 flex-1 overflow-auto">
          {activeTab === 'overview' && <OverviewTab project={project} />}
          {activeTab === 'documents' && (
            <DocumentsTab project={project} syncNonce={syncNonce} />
          )}
          {activeTab === 'kanban' && (
            <KanbanTab projectId={projectId} syncNonce={syncNonce} />
          )}
          {activeTab === 'graph' && (
            <GraphTab projectId={projectId} syncNonce={syncNonce} />
          )}
          {activeTab === 'architecture' && (
            <ArchitectureTab
              projectId={projectId}
              syncNonce={syncNonce}
              onCorrect={() => setMapping({ open: true, focus: 'architecture' })}
              onReload={() => setSyncNonce((n) => n + 1)}
            />
          )}
          {activeTab === 'design' && (
            <DesignTab
              projectId={projectId}
              syncNonce={syncNonce}
              onCorrect={() => setMapping({ open: true, focus: 'design' })}
              onReload={() => setSyncNonce((n) => n + 1)}
            />
          )}
          {activeTab === 'decisions' && (
            <DecisionsTab
              projectId={projectId}
              syncNonce={syncNonce}
              onCorrect={() => setMapping({ open: true, focus: 'decisions' })}
            />
          )}
          {activeTab === 'tests' && (
            <TestsTab
              projectId={projectId}
              syncNonce={syncNonce}
              onCorrect={() => setMapping({ open: true, focus: 'testing' })}
            />
          )}
          {activeTab === 'deploy' && (
            <DeployTab
              projectId={projectId}
              syncNonce={syncNonce}
              onCorrect={() => setMapping({ open: true, focus: 'deploy' })}
            />
          )}
          {activeTab === 'skills' && (
            <SkillsTab
              projectId={projectId}
              syncNonce={syncNonce}
              onCorrect={() => setMapping({ open: true, focus: 'skills' })}
            />
          )}
          {activeTab === 'context' && (
            <ContextTab projectId={projectId} syncNonce={syncNonce} />
          )}
          {activeTab === 'handoff' && (
            <HandoffTab projectId={projectId} syncNonce={syncNonce} />
          )}
        </main>

        {mapping.open && (
          <MappingScreen
            projectId={projectId}
            focusEntity={mapping.focus}
            onClose={() => setMapping({ open: false, focus: null })}
            onSaved={() => {
              setMapping({ open: false, focus: null });
              setSyncNonce((n) => n + 1);
            }}
          />
        )}

        {activityOpen && (
          <ActivityPanel
            projectId={projectId}
            projectName={project.name}
            refreshNonce={syncNonce}
            onClose={() => setActivityOpen(false)}
          />
        )}
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

const SYNC_POLL_MS = 1200;
const SYNC_TIMEOUT_MS = 60_000;

/** Faz polling do sync-run até terminar (success|noop|failed). */
async function pollSyncRun(projectId: string, runId: string): Promise<SyncRun> {
  const start = Date.now();
  for (;;) {
    const run = await api.latestSyncRun(projectId);
    if (run && run.id === runId && run.status !== 'queued' && run.status !== 'running') {
      return run;
    }
    if (Date.now() - start > SYNC_TIMEOUT_MS) {
      throw new Error('tempo esgotado');
    }
    await new Promise((r) => setTimeout(r, SYNC_POLL_MS));
  }
}

/** Toast com o resultado do sync (política de toasts do DESIGN.md §8). */
function reportSync(run: SyncRun, toastId: string | number): void {
  if (run.status === 'failed') {
    toast.error(`Sincronização falhou: ${run.error ?? 'erro desconhecido'}`, {
      id: toastId,
    });
    return;
  }
  if (run.status === 'noop') {
    toast.info('Já estava atualizado — nada mudou.', { id: toastId });
    return;
  }
  const parts = [
    run.added && `${run.added} novo${run.added > 1 ? 's' : ''}`,
    run.updated && `${run.updated} atualizado${run.updated > 1 ? 's' : ''}`,
    run.removed && `${run.removed} removido${run.removed > 1 ? 's' : ''}`,
  ].filter(Boolean);
  toast.success(
    parts.length ? `Sincronizado — ${parts.join(', ')}.` : 'Sincronizado.',
    { id: toastId },
  );
}
