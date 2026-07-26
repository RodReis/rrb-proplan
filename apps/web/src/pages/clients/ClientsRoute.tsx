import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { setActiveTenant, type SessionUser } from '../../lib/api';

interface Props {
  user: SessionUser;
  children: (canWrite: boolean) => React.ReactNode;
}

/**
 * Resolve o tenant da rota `/t/:tenant/clients…` antes de renderizar (SPEC-029).
 *
 * Duas coisas que o filho não pode fazer sozinho:
 *
 * 1. **Fixar o tenant ativo** (`setActiveTenant`) — sem isso o `request()` não
 *    prefixa `/clients` com `/t/:tenant` e a API responde 404.
 * 2. **Resolver o papel** para o RBAC da UI. `viewer` não vê os controles de
 *    escrita; a API recusa de qualquer jeito (403), e é essa a ordem certa —
 *    esconder o botão é conveniência, a barreira é o servidor.
 *
 * Aceita slug ou UUID no path, como as rotas de workspace: o token da URL casa
 * contra `accountLogin` e contra `id` das memberships da sessão. Não-membro cai
 * no catálogo — mesma resposta para tenant alheio e inexistente, sem vazar qual
 * dos dois é.
 */
export function ClientsRoute({ user, children }: Props) {
  const { tenant = '' } = useParams();
  const [ready, setReady] = useState(false);

  const token = tenant.toLowerCase();
  const membership = user.tenants.find(
    (t) => t.id === tenant || t.accountLogin.toLowerCase() === token,
  );

  useEffect(() => {
    if (!membership) return;
    setActiveTenant(membership.id);
    setReady(true);
    // Ao sair, solta o tenant: deixá-lo fixo faria uma chamada global seguinte
    // sair escopada por engano.
    return () => setActiveTenant(null);
  }, [membership]);

  if (!membership) return <Navigate to="/" replace />;
  if (!ready) return null;

  return <>{children(membership.role !== 'viewer')}</>;
}
