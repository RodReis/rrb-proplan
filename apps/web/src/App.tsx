import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { api, SessionUser, UnauthorizedError } from './lib/api';
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
        <Route
          path="/p/:projectId/:tab"
          element={<WorkspaceRoute user={auth.user} onLogout={logout} />}
        />
        {/* Sem aba na URL → aba padrão, preservando o projeto. */}
        <Route path="/p/:projectId" element={<RedirectToDefaultTab />} />
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

/** `/p/:id` → `/p/:id/overview`. */
function RedirectToDefaultTab() {
  const { projectId } = useParams();
  return <Navigate to={`/p/${projectId}/overview`} replace />;
}
