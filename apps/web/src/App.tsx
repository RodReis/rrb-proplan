import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { api, SessionUser, UnauthorizedError } from './lib/api';
import { useTheme } from './theme';
import { Login } from './pages/Login';
import { Catalog } from './pages/Catalog';
import { SettingsPage } from './pages/SettingsPage';
import { ResolveRoute } from './pages/workspace/ResolveRoute';
import { WorkspaceRoute } from './pages/workspace/WorkspaceRoute';
import { ClientsRoute } from './pages/clients/ClientsRoute';
import { ClientsPage } from './pages/clients/ClientsPage';
import { FunnelPage } from './pages/clients/FunnelPage';

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
        {/* Configurações fora do shell de workspace (SPEC-025 §1): sem GitHub
            conectado não há workspace, e é justamente aí que se precisa dela. */}
        <Route
          path="/settings"
          element={<SettingsPage user={auth.user} onLogout={logout} />}
        />
        {/* Rotas de projeto sob /t/:tenant (SPEC-022), com slug legível no lugar
            do UUID (SPEC-028). O ResolveRoute traduz os tokens da URL — slug ou
            uuid — nos ids canônicos e fixa o tenant ativo (api.setActiveTenant)
            com o ID resolvido antes de renderizar o workspace, para toda chamada
            de projeto já sair escopada. */}
        <Route
          path="/t/:tenant/p/:project/:tab"
          element={
            <ResolveRoute>
              {(resolved) => (
                <WorkspaceRoute user={auth.user} onLogout={logout} resolved={resolved} />
              )}
            </ResolveRoute>
          }
        />
        {/* Sem aba na URL → aba padrão, preservando tenant e projeto. */}
        <Route path="/t/:tenant/p/:project" element={<RedirectToDefaultTab />} />
        {/* Frente Clientes (SPEC-029): shell PRÓPRIO no nível do tenant, irmão
            do workspace de repo — não uma aba dele. Um cliente não tem
            repositório, então não haveria `:project` para pôr no path (decisão
            do PI, 2026-07-25). */}
        <Route
          path="/t/:tenant/clients"
          element={
            <ClientsRoute user={auth.user}>
              {(canWrite) => <ClientsPage canWrite={canWrite} />}
            </ClientsRoute>
          }
        />
        <Route
          path="/t/:tenant/clients/funil"
          element={
            <ClientsRoute user={auth.user}>
              {(canWrite) => <FunnelPage canWrite={canWrite} />}
            </ClientsRoute>
          }
        />
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

/**
 * `/t/:tenant/p/:project` → `/t/:tenant/p/:project/overview`. Preserva os tokens
 * como vieram (slug ou uuid); a canonização para slug é do ResolveRoute, depois
 * de resolver.
 */
function RedirectToDefaultTab() {
  const { tenant, project } = useParams();
  return <Navigate to={`/t/${tenant}/p/${project}/overview`} replace />;
}
