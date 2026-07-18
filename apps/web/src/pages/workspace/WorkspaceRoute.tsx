import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, Project, SessionUser } from '../../lib/api';
import { touchProject } from '../../lib/lastAccess';
import { ProjectNotFound } from '../ProjectNotFound';
import { WORKSPACE_TABS } from './tabs';
import { Workspace } from './Workspace';

interface Props {
  user: SessionUser;
  onLogout: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; projects: Project[]; project: Project };

/**
 * Resolve `/p/:projectId/:tab` (SPEC-020 §6): a URL é a fonte da navegação —
 * F5 e link direto voltam ao mesmo projeto/aba.
 *
 * Carrega a lista inteira de projetos, não só o aberto: o combo da sidebar
 * precisa dela, e é uma chamada só para os dois usos.
 */
export function WorkspaceRoute({ user, onLogout }: Props) {
  const { tenant, projectId, tab } = useParams<{ tenant: string; projectId: string; tab: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setState({ status: 'loading' });
    api
      .projects()
      .then((projects) => {
        if (!alive) return;
        const project = projects.find((p) => p.id === projectId);
        // Projeto removido (inclusive desgerenciado em outra aba) → 404 amigável.
        setState(
          project ? { status: 'ready', projects, project } : { status: 'missing' },
        );
      })
      .catch(() => alive && setState({ status: 'missing' }));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Último acesso alimenta a ordem do combo — só conta projeto que existe.
  useEffect(() => {
    if (state.status === 'ready') touchProject(state.project.id);
  }, [state]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-8 w-40 animate-pulse rounded-[10px] bg-card" />
      </div>
    );
  }

  if (state.status === 'missing') return <ProjectNotFound />;

  // Aba desconhecida na URL → aba padrão (contrato da SPEC-020).
  const known = WORKSPACE_TABS.some((t) => t.id === tab);
  if (!known) return <Navigate to={`/t/${tenant}/p/${state.project.id}/overview`} replace />;

  // Papel do usuário no tenant ativo (SPEC-022). viewer → board read-only.
  // Ausente (não deveria, pós-migração) = viewer por segurança (menos privilégio).
  const role = user.tenants.find((t) => t.id === tenant)?.role ?? 'viewer';

  return (
    <Workspace
      key={state.project.id}
      user={user}
      role={role}
      project={state.project}
      projects={state.projects}
      activeTab={tab!}
      onSelectTab={(next) => navigate(`/t/${tenant}/p/${state.project.id}/${next}`)}
      onSelectProject={(id) => navigate(`/t/${tenant}/p/${id}/overview`)}
      onBackToCatalog={() => navigate('/')}
      onLogout={onLogout}
    />
  );
}
