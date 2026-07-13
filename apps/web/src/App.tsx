import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { api, SessionUser, UnauthorizedError } from './lib/api';
import { Login } from './pages/Login';
import { Home } from './pages/Home';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: SessionUser };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    api
      .me()
      .then((user) => setAuth({ status: 'authenticated', user }))
      .catch((err) =>
        setAuth(
          err instanceof UnauthorizedError
            ? { status: 'anonymous' }
            : { status: 'anonymous' },
        ),
      );
  }, []);

  if (auth.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-40 animate-pulse rounded-md bg-border" />
      </div>
    );
  }

  if (auth.status === 'anonymous') return <Login />;

  return (
    <>
      <Home
        user={auth.user}
        onLogout={() => {
          void api.logout().then(() => setAuth({ status: 'anonymous' }));
        }}
      />
      <Toaster position="top-right" theme="light" richColors closeButton />
    </>
  );
}
