import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, Project, ResolvedRoute, SessionUser } from '../../lib/api';
import { touchProject } from '../../lib/lastAccess';
import { ProjectNotFound } from '../ProjectNotFound';
import { WORKSPACE_TABS } from './tabs';
import { Workspace } from './Workspace';

interface Props {
  user: SessionUser;
  onLogout: () => void;
  /** Ids + slugs canônicos já resolvidos pelo ResolveRoute (SPEC-028). */
  resolved: ResolvedRoute;
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
export function WorkspaceRoute({ user, onLogout, resolved }: Props) {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  // Ids canônicos vêm do ResolveRoute; os slugs são só para montar as URLs.
  const { tenantId, projectId, tenantSlug } = resolved;

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

  // URL do workspace na forma canônica (slug), SPEC-028. O projeto vem da lista
  // já carregada — nenhuma chamada extra para trocar de aba ou de projeto.
  const slugOf = (p: Project) => p.name.toLowerCase();
  const urlFor = (p: Project, nextTab: string) =>
    `/t/${tenantSlug}/p/${slugOf(p)}/${nextTab}`;

  // Aba desconhecida na URL → aba padrão (contrato da SPEC-020).
  const known = WORKSPACE_TABS.some((t) => t.id === tab);
  if (!known) return <Navigate to={urlFor(state.project, 'overview')} replace />;

  // Papel do usuário no tenant ativo (SPEC-022). viewer → board read-only.
  // Casa pelo ID resolvido, não pelo token da URL (que agora pode ser slug).
  // Ausente (não deveria, pós-migração) = viewer por segurança (menos privilégio).
  const role = user.tenants.find((t) => t.id === tenantId)?.role ?? 'viewer';

  return (
    <Workspace
      key={state.project.id}
      user={user}
      role={role}
      project={state.project}
      projects={state.projects}
      activeTab={tab!}
      onSelectTab={(next) => navigate(urlFor(state.project, next))}
      // O combo entrega o ID do projeto; a URL vai por slug. O projeto está na
      // lista já carregada — se não estiver (corrida com remoção noutra aba), o
      // id na URL ainda resolve (o /resolve aceita as duas formas).
      onSelectProject={(id) => {
        const target = state.projects.find((p) => p.id === id);
        navigate(
          target ? urlFor(target, 'overview') : `/t/${tenantSlug}/p/${id}/overview`,
        );
      }}
      onBackToCatalog={() => navigate('/')}
      onLogout={onLogout}
    />
  );
}
