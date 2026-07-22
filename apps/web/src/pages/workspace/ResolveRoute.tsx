import { ReactNode, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ResolvedRoute, setActiveTenant } from '../../lib/api';
import { ProjectNotFound } from '../ProjectNotFound';

/**
 * Resolve `/t/:tenant/p/:project` — slug OU uuid — nos ids canônicos antes de
 * renderizar o workspace (SPEC-028).
 *
 * Por que aqui e não dentro do WorkspaceRoute: o tenant ativo precisa estar
 * fixado ANTES de qualquer chamada de projeto (`api` prefixa `/t/:tenant/...`
 * com ele), e o que vai nesse prefixo é o **id**, não o slug — o contrato de
 * escopo da SPEC-022 não muda. Este componente é o antigo `TenantSync` com a
 * tradução na frente.
 *
 * Resolve **no mount** e a cada troca de tenant/projeto na URL: é o que faz F5
 * e link direto voltarem ao mesmo lugar sem baixar o catálogo inteiro.
 */
export function ResolveRoute({
  children,
}: {
  children: (resolved: ResolvedRoute) => ReactNode;
}) {
  const { tenant, project, tab } = useParams();
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'missing' } | { status: 'ready'; resolved: ResolvedRoute }
  >({ status: 'loading' });

  useEffect(() => {
    if (!tenant || !project) return;
    let alive = true;
    setState({ status: 'loading' });
    api
      .resolve(tenant, project)
      .then((resolved) => {
        if (!alive) return;
        // O tenant ativo é o ID resolvido — nunca o token da URL, que pode ser
        // slug. Setado antes de liberar o workspace para que a primeira chamada
        // de projeto já saia escopada.
        setActiveTenant(resolved.tenantId);
        setState({ status: 'ready', resolved });
      })
      // Tenant/projeto alheio ou inexistente → 404 amigável (o /resolve é
      // fail-closed sob RLS; aqui só refletimos).
      .catch(() => alive && setState({ status: 'missing' }));
    return () => {
      alive = false;
    };
  }, [tenant, project]);

  // Limpa ao sair do workspace: o catálogo é rota global, sem tenant fixo.
  useEffect(() => () => setActiveTenant(null), []);

  // Entrou por UUID ou com caixa diferente → reescreve para a forma canônica.
  // `replace` (não push) para o botão Voltar não cair na URL feia de novo.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const { tenantSlug, projectSlug } = state.resolved;
    if (tenant === tenantSlug && project === projectSlug) return;
    const suffix = tab ? `/${tab}` : '';
    navigate(`/t/${tenantSlug}/p/${projectSlug}${suffix}${search}${hash}`, {
      replace: true,
    });
  }, [state, tenant, project, tab, search, hash, navigate]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-8 w-40 animate-pulse rounded-[10px] bg-card" />
      </div>
    );
  }

  if (state.status === 'missing') return <ProjectNotFound />;

  return <>{children(state.resolved)}</>;
}
