import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { createClient, deleteClient, listClients, type Client } from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ClientsShell } from './ClientsShell';
import { initials } from './boardView';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clients: Client[] };

/**
 * Lista de clientes (SPEC-029) — `/t/:tenant/clients`.
 *
 * Busca por nome, empresa e CNPJ acontece no SERVIDOR (a lista pode crescer
 * além do que cabe em memória, e o filtro precisa respeitar o RLS).
 */
export function ClientsPage({ canWrite }: { canWrite: boolean }) {
  const { tenant = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      setState({ status: 'ready', clients: await listClients(q) });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar',
      });
    }
  }, []);

  useEffect(() => {
    // Debounce: cada tecla dispararia uma request ao servidor.
    const timer = setTimeout(() => void load(query), 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  async function handleCreate(input: Partial<Client>) {
    try {
      await createClient(input);
      setCreating(false);
      toast.success('Cliente criado');
      await load(query);
    } catch {
      toast.error('Não foi possível criar o cliente');
    }
  }

  async function handleDelete(client: Client) {
    setConfirmDelete(null);
    try {
      await deleteClient(client.id);
      toast.success(`${client.name} removido da lista`);
      await load(query);
    } catch {
      toast.error('Não foi possível remover');
    }
  }

  return (
    <ClientsShell
      tenant={tenant}
      title="Clientes"
      subtitle="Quem contrata, quais projetos e em que ponto está cada relação."
      actions={
        canWrite ? (
          <button onClick={() => setCreating(true)} style={primaryButton}>
            + Novo cliente
          </button>
        ) : null
      }
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nome, empresa ou CNPJ"
        aria-label="Buscar clientes"
        style={{
          width: '100%',
          maxWidth: 380,
          marginBottom: 20,
          padding: '9px 12px',
          borderRadius: 8,
          border: '1px solid var(--border2)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: 14,
        }}
      />

      {state.status === 'loading' && <p style={muted}>Carregando…</p>}
      {state.status === 'error' && (
        <p style={{ ...muted, color: 'var(--error)' }}>{state.message}</p>
      )}

      {state.status === 'ready' && state.clients.length === 0 && (
        <p style={muted}>
          {query
            ? 'Nenhum cliente encontrado para esta busca.'
            : 'Nenhum cliente ainda. Comece cadastrando o primeiro.'}
        </p>
      )}

      {state.status === 'ready' && state.clients.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {state.clients.map((client) => (
            <li
              key={client.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 10,
                border: '1px solid var(--border2)',
                background: 'var(--card)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--surface2)',
                  color: 'var(--body2)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {initials(client.name)}
              </span>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 600 }}>
                  {client.name}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {[client.company, client.email].filter(Boolean).join(' · ') ||
                    'sem contato cadastrado'}
                </div>
              </div>

              {canWrite && (
                <button onClick={() => setConfirmDelete(client)} style={ghostButton}>
                  Remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewClientDialog onCancel={() => setCreating(false)} onCreate={handleCreate} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Remover ${confirmDelete.name}?`}
          // A exclusão é lógica: a linha e o histórico do funil permanecem no
          // banco. Dizer "excluído para sempre" aqui seria mentira.
          message="O cliente sai das listas, mas o histórico dos projetos dele é preservado."
          confirmLabel="Remover"
          onConfirm={() => void handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </ClientsShell>
  );
}

function NewClientDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: Partial<Client>) => void;
}) {
  const [form, setForm] = useState({ name: '', company: '', cnpj: '', email: '' });

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Novo cliente">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) onCreate(form);
        }}
        style={{
          width: 420,
          padding: 22,
          borderRadius: 12,
          background: 'var(--pop)',
          border: '1px solid var(--border3)',
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 17, color: 'var(--text)' }}>
          Novo cliente
        </h2>

        {(['name', 'company', 'cnpj', 'email'] as const).map((field) => (
          <label key={field} style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
              {LABELS[field]}
              {field === 'name' && ' *'}
            </span>
            <input
              value={form[field]}
              required={field === 'name'}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              style={{
                width: '100%',
                marginTop: 4,
                padding: '8px 10px',
                borderRadius: 7,
                border: '1px solid var(--border2)',
                background: 'var(--surface)',
                color: 'var(--text)',
              }}
            />
          </label>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onCancel} style={ghostButton}>
            Cancelar
          </button>
          <button type="submit" style={primaryButton}>
            Criar
          </button>
        </div>
      </form>
    </div>
  );
}

const LABELS = {
  name: 'Nome',
  company: 'Empresa',
  cnpj: 'CNPJ',
  email: 'E-mail',
} as const;

const muted = { color: 'var(--muted)', fontSize: 14 } as const;

const primaryButton = {
  padding: '9px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--btnbg)',
  color: 'var(--btnfg)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
} as const;

const ghostButton = {
  padding: '7px 13px',
  borderRadius: 7,
  border: '1px solid var(--border2)',
  background: 'transparent',
  color: 'var(--body)',
  fontSize: 13,
  cursor: 'pointer',
} as const;

const overlay = {
  position: 'fixed' as const,
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0,0,0,0.55)',
  zIndex: 50,
};
