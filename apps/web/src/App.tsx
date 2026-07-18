import { ReactNode, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { api, setActiveTenant, SessionUser, UnauthorizedError } from './lib/api';
import { useTheme } from './theme';
import { Login } from './pages/Login';
import { Catalog } from './pages/Catalog';
import { WorkspaceRoute } from './pages/workspace/WorkspaceRoute';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: SessionUser };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const { theme } = useTheme();

  useEffect(() => {
    api
      .me()
      .then((user) => setAuth({ status: 'authenticated', user }))
      .catch((err) => {
        // Rede/servidor fora não é "anônimo", mas a tela de login é o único
        // lugar seguro para cair — e é de lá que dá para tentar de novo.
        if (!(err instanceof UnauthorizedError)) {
          console.error('Falha ao carregar a sessão:', err);
        }
        setAuth({ status: 'anonymous' });
      });
  }, []);

  if (auth.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-8 w-40 animate-pulse rounded-[10px] bg-card" />
      </div>
    );
  }

  if (auth.status === 'anonymous') return <Login />;

  const logout = () => {
    void api.logout().then(() => setAuth({ status: 'anonymous' }));
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Catalog user={auth.user} onLogout={logout} />} />
        {/* Rotas de projeto sob /t/:tenant (SPEC-022). O TenantSync fixa o
            tenant ativo (api.setActiveTenant) a partir da URL antes de renderizar
            o workspace — assim toda chamada de projeto já sai escopada. */}
        <Route
          path="/t/:tenant/p/:projectId/:tab"
          element={
            <TenantSync>
              <WorkspaceRoute user={auth.user} onLogout={logout} />
            </TenantSync>
          }
        />
        {/* Sem aba na URL → aba padrão, preservando tenant e projeto. */}
        <Route path="/t/:tenant/p/:projectId" element={<RedirectToDefaultTab />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* Toast segue o tema ativo, canto inferior direito (DESIGN.md §6) — o par
          theme="light"/top-right era da paleta antiga. */}
      <Toaster
        position="bottom-right"
        theme={theme === 'carbono' ? 'dark' : 'light'}
        richColors
        closeButton
      />
    </BrowserRouter>
  );
}

/** `/t/:tenant/p/:id` → `/t/:tenant/p/:id/overview`. */
function RedirectToDefaultTab() {
  const { tenant, projectId } = useParams();
  return <Navigate to={`/t/${tenant}/p/${projectId}/overview`} replace />;
}

/**
 * Fixa o tenant ativo (api.setActiveTenant) a partir da URL, para que as
 * chamadas de projeto saiam escopadas em /t/:tenant (SPEC-022). Limpa ao
 * desmontar (sair do workspace) — o catálogo é rota global, sem tenant fixo.
 * Trocar de tenant remonta este componente (a key de tenant na rota), então o
 * efeito re-roda e reaponta — o estado do tenant anterior não sobrevive.
 */
function TenantSync({ children }: { children: ReactNode }) {
  const { tenant } = useParams();
  useEffect(() => {
    setActiveTenant(tenant ?? null);
    return () => setActiveTenant(null);
  }, [tenant]);
  return <>{children}</>;
}
