import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getDashboard, setActiveTenant, type SessionUser } from '../lib/api';

interface Props {
  user: SessionUser;
}

/**
 * Porta de entrada depois do login (`/entrar`) — FIX #230, decisão do PI
 * (2026-07-31): **quem entra cai no Dashboard**, não no Catálogo.
 *
 * Existe como rota própria, e não como redirect dentro do Catálogo, porque a
 * decisão é do *momento do login*: mandar todo mundo que abre `/` para o
 * dashboard tornaria o Catálogo inalcançável pelo menu.
 *
 * ## Por que decidir aqui, e não no `res.redirect` da API
 *
 * O destino depende de o tenant ter cliente — a SPEC-035 §2.12 diz que o
 * Dashboard **some** sem cliente nenhum, e cair numa tela que o menu esconde
 * seria contradizê-la. Quem sabe disso é o `GET /dashboard`, então a escolha
 * mora do lado que já vai fazer essa chamada de qualquer jeito.
 *
 * Sem cliente, ou se a chamada falhar, o destino é o Catálogo: ele funciona em
 * qualquer estado, inclusive com o GitHub desconectado.
 */
export function EntryRoute({ user }: Props) {
  const [destino, setDestino] = useState<string | null>(null);
  const membership = user.tenants[0];

  useEffect(() => {
    if (!membership) {
      setDestino('/');
      return;
    }
    let vivo = true;
    // O tenant precisa estar fixo ANTES da chamada: sem ele o `request()` não
    // prefixa `/dashboard` com `/t/:tenant` e a API devolve 404 (o mesmo laço
    // que escondia o item do menu).
    setActiveTenant(membership.id);
    getDashboard()
      .then((view) => {
        if (!vivo) return;
        setDestino(
          view.hasAnyClient ? `/t/${membership.accountLogin.toLowerCase()}/dashboard` : '/',
        );
      })
      // Falhou: o Catálogo é o destino que funciona em qualquer estado.
      .catch(() => vivo && setDestino('/'))
      .finally(() => setActiveTenant(null));
    return () => {
      vivo = false;
    };
  }, [membership]);

  // Mesmo esqueleto do `App` enquanto a sessão resolve — não piscar uma tela
  // que vai ser trocada em seguida.
  if (!destino) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="h-8 w-40 animate-pulse rounded-[10px] bg-card" />
      </div>
    );
  }
  return <Navigate to={destino} replace />;
}
