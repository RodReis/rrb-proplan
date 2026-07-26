import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  createClient,
  deleteClient,
  listClients,
  updateClient,
  type Client,
} from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ClientDetailPanel } from './ClientDetailPanel';
import { ClientsShell } from './ClientsShell';
import { initials } from './boardView';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clients: Client[] };

type ClientForm = {
  name: string;
  cpf: string;
  company: string;
  cnpj: string;
  email: string;
  phone: string;
  whatsapp: string;
  zipCode: string;
  street: string;
  district: string;
  city: string;
  state: string;
  notes: string;
};

const MASKED_FIELDS: Partial<Record<keyof ClientForm, number>> = {
  cpf: 11,
  cnpj: 14,
  phone: 11,
  whatsapp: 11,
  zipCode: 8,
};

const CLIENT_FIELDS: {
  key: keyof ClientForm;
  label: string;
  required?: boolean;
  multiline?: boolean;
}[] = [
  { key: 'name', label: 'Nome', required: true },
  { key: 'cpf', label: 'CPF' },
  { key: 'company', label: 'Empresa' },
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Telefone' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'zipCode', label: 'CEP' },
  { key: 'street', label: 'Logradouro' },
  { key: 'district', label: 'Bairro' },
  { key: 'city', label: 'Cidade' },
  { key: 'state', label: 'Estado' },
  { key: 'notes', label: 'Notas internas', multiline: true },
];

const CLIENT_FIELD_SECTIONS: {
  title: string;
  fields: (keyof ClientForm)[];
}[] = [
  { title: 'Identificação', fields: ['name', 'cpf', 'company', 'cnpj'] },
  { title: 'Contato', fields: ['email', 'phone', 'whatsapp'] },
  { title: 'Endereço', fields: ['zipCode', 'street', 'district', 'city', 'state'] },
  { title: 'Notas', fields: ['notes'] },
];

const FIELD_BY_KEY = Object.fromEntries(
  CLIENT_FIELDS.map((field) => [field.key, field]),
) as Record<keyof ClientForm, (typeof CLIENT_FIELDS)[number]>;

const emptyClient: Client = {
  id: '',
  name: '',
  cpf: null,
  company: null,
  cnpj: null,
  email: null,
  phone: null,
  whatsapp: null,
  zipCode: null,
  street: null,
  district: null,
  city: null,
  state: null,
  notes: null,
  createdAt: '',
};

function onlyDigits(value: string, max?: number): string {
  const digits = value.replace(/\D/g, '');
  return max ? digits.slice(0, max) : digits;
}

function formatCpf(value: string): string {
  const digits = onlyDigits(value, 11);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function formatCnpj(value: string): string {
  const digits = onlyDigits(value, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatPhone(value: string): string {
  const digits = onlyDigits(value, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  return digits
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
}

function formatZipCode(value: string): string {
  return onlyDigits(value, 8).replace(/^(\d{5})(\d)/, '$1-$2');
}

function formatField(key: keyof ClientForm, value: string): string {
  if (key === 'cpf') return formatCpf(value);
  if (key === 'cnpj') return formatCnpj(value);
  if (key === 'phone' || key === 'whatsapp') return formatPhone(value);
  if (key === 'zipCode') return formatZipCode(value);
  return value;
}

function normalizeField(key: keyof ClientForm, value: string): string {
  const max = MASKED_FIELDS[key];
  return max ? onlyDigits(value, max) : value;
}

function inputType(key: keyof ClientForm): string | undefined {
  if (key === 'email') return 'email';
  return undefined;
}

function toForm(client: Client): ClientForm {
  return {
    name: client.name,
    cpf: onlyDigits(client.cpf ?? '', 11),
    company: client.company ?? '',
    cnpj: onlyDigits(client.cnpj ?? '', 14),
    email: client.email ?? '',
    phone: onlyDigits(client.phone ?? '', 11),
    whatsapp: onlyDigits(client.whatsapp ?? '', 11),
    zipCode: onlyDigits(client.zipCode ?? '', 8),
    street: client.street ?? '',
    district: client.district ?? '',
    city: client.city ?? '',
    state: client.state ?? '',
    notes: client.notes ?? '',
  };
}

function cleanForm(form: ClientForm): Partial<Client> {
  return Object.fromEntries(
    Object.entries(form).map(([key, value]) => [key, value.trim() || null]),
  ) as Partial<Client>;
}

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
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null);
  /** Cliente aberto no detalhe — a porta de entrada dos projetos (FIX #134). */
  const [openClient, setOpenClient] = useState<Client | null>(null);

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
      setEditingClient(null);
      toast.success('Cliente criado');
      await load(query);
    } catch {
      toast.error('Não foi possível criar o cliente');
    }
  }

  async function handleUpdate(client: Client, input: Partial<Client>) {
    try {
      await updateClient(client.id, input);
      setEditingClient(null);
      toast.success('Cliente atualizado');
      await load(query);
    } catch {
      toast.error('Não foi possível salvar');
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

  const clients = state.status === 'ready' ? state.clients : [];

  return (
    <ClientsShell
      tenant={tenant}
      title="Clientes"
      subtitle="Quem contrata, quais projetos e em que ponto está cada relação."
      actions={
        canWrite ? (
          <button
            onClick={() => setEditingClient(emptyClient)}
            className="flex h-9 items-center justify-center rounded-[9px] border px-4 text-[12.5px] font-semibold text-text backdrop-blur-md transition-[filter] duration-150 hover:brightness-110 max-[720px]:w-full"
            style={heroActionButton}
          >
            + Novo cliente
          </button>
        ) : null
      }
    >
      <section className="overflow-hidden rounded-[14px] border border-border bg-panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <label className="flex h-9 min-w-[260px] flex-1 items-center rounded-[9px] border border-border2 bg-surface px-3 text-[13px] text-muted transition-colors focus-within:border-hoverb">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, empresa ou CNPJ"
              aria-label="Buscar clientes"
              className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
            />
          </label>
          <span className="rounded-full border border-border2 bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            {state.status === 'ready' ? clients.length : 0} clientes
          </span>
          {!canWrite && (
            <span className="rounded-full border border-border2 bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              somente leitura
            </span>
          )}
        </div>

        {state.status === 'loading' && (
          <div className="grid gap-0">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-[72px] animate-pulse border-b border-border/70 bg-surface" />
            ))}
          </div>
        )}
        {state.status === 'error' && (
          <p className="m-4 rounded-[12px] border border-error/30 bg-error/5 p-4 text-sm text-error">
            {state.message}
          </p>
        )}

        {state.status === 'ready' && clients.length === 0 && (
          <div className="p-8 text-center text-sm text-muted">
            {query
              ? 'Nenhum cliente encontrado para esta busca.'
              : 'Nenhum cliente ainda. Comece cadastrando o primeiro.'}
          </div>
        )}

        {state.status === 'ready' && clients.length > 0 && (
          <ul className="m-0 grid list-none p-0">
            {clients.map((client) => (
              <li
                key={client.id}
                // Clicar na linha abre o detalhe (projetos do cliente). Vale
                // para viewer também: ler não é escrever, e sem esta porta o
                // funil não tem como receber card (FIX #134).
                onClick={() => setOpenClient(client)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setOpenClient(client);
                }}
                tabIndex={0}
                role="button"
                aria-label={`Abrir projetos de ${client.name}`}
                className="grid min-h-[72px] cursor-pointer grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-4 border-b border-border/70 px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-card/45 max-[720px]:grid-cols-[40px_minmax(0,1fr)] max-[720px]:gap-y-3"
              >
                <span
                  aria-hidden
                  className="grid h-10 w-10 place-items-center rounded-[10px] border border-border2 bg-surface2 font-mono text-[11px] font-semibold text-body2"
                >
                  {initials(client.name)}
                </span>

                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[14px] font-semibold text-text">
                      {client.name}
                    </span>
                    {client.company && (
                      <span className="max-w-[260px] truncate rounded-full border border-border2 px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
                        {client.company}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted">
                    <span>{client.email ?? 'sem e-mail'}</span>
                    <span>{formatPhone(client.whatsapp || client.phone || '') || 'sem telefone'}</span>
                    <span>{[client.city, client.state].filter(Boolean).join(' / ') || 'sem endereço'}</span>
                  </div>
                </div>

                {canWrite && (
                  // `stopPropagation`: a linha inteira abre o detalhe, então sem
                  // isto clicar em Editar/Remover abriria a gaveta por baixo do
                  // diálogo (mesmo padrão do link `#N` no KanbanCard).
                  <div className="flex justify-end gap-2 max-[720px]:col-span-2 max-[720px]:justify-start">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingClient(client);
                      }}
                      style={ghostButton}
                    >
                      Editar
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(client);
                      }}
                      style={dangerGhostButton}
                    >
                      Remover
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {openClient && (
        <ClientDetailPanel
          client={openClient}
          canWrite={canWrite}
          onClose={() => setOpenClient(null)}
          // Projeto criado/link mexido ⇒ a lista atrás pode ter mudado.
          onChanged={() => void load(query)}
        />
      )}

      {editingClient !== null && (
        <ClientDialog
          client={editingClient.id ? editingClient : undefined}
          onCancel={() => setEditingClient(null)}
          onSubmit={(input) =>
            editingClient.id
              ? void handleUpdate(editingClient, input)
              : void handleCreate(input)
          }
        />
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

function ClientDialog({
  client = emptyClient,
  onCancel,
  onSubmit,
}: {
  client?: Client;
  onCancel: () => void;
  onSubmit: (input: Partial<Client>) => void;
}) {
  const isEditing = Boolean(client.id);
  const [form, setForm] = useState<ClientForm>(() => toForm(client));
  const titleId = isEditing ? 'edit-client-title' : 'new-client-title';

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onCancel();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute('disabled'));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      style={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleDialogKeyDown}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) onSubmit(cleanForm(form));
        }}
        style={dialogPanel}
      >
        <div style={dialogHeader}>
          <span aria-hidden style={dialogAvatar}>{initials(form.name || client.name || 'Cliente')}</span>
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 17, color: 'var(--text)' }}>
              {isEditing ? 'Editar cliente' : 'Novo cliente'}
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12.5 }}>
              {form.company || form.email || 'Dados comerciais, contato e endereço.'}
            </p>
          </div>
        </div>

        <div style={dialogSections}>
          {CLIENT_FIELD_SECTIONS.map((section) => (
            <section key={section.title} style={dialogSection}>
              <h3 style={dialogSectionTitle}>{section.title}</h3>
              <div style={formGrid}>
                {section.fields.map((key) => {
                  const field = FIELD_BY_KEY[key];
                  const fullWidth = field.multiline || field.key === 'name';
                  return (
                    <label
                      key={field.key}
                      style={fullWidth ? fullWidthFieldLabel : fieldLabel}
                    >
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
                        {field.label}
                        {field.required && ' *'}
                      </span>
                      {field.multiline ? (
                        <textarea
                          value={form[field.key] ?? ''}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              [field.key]: normalizeField(field.key, e.target.value),
                            })
                          }
                          style={notesInputStyle}
                        />
                      ) : (
                        <input
                          autoFocus={field.key === 'name'}
                          value={formatField(field.key, form[field.key] ?? '')}
                          required={field.required}
                          type={inputType(field.key)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              [field.key]: normalizeField(field.key, e.target.value),
                            })
                          }
                          inputMode={MASKED_FIELDS[field.key] ? 'numeric' : undefined}
                          style={inputStyle}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div style={dialogActions}>
          <button type="button" onClick={onCancel} style={ghostButton}>
            Cancelar
          </button>
          <button type="submit" style={primaryButton}>
            {isEditing ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  );
}

const dialogPanel = {
  width: 'min(840px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 32px)',
  overflow: 'auto',
  padding: 0,
  borderRadius: 12,
  background: 'var(--pop)',
  border: '1px solid var(--border3)',
  boxShadow: '0 24px 80px var(--shadow)',
} as const;

const dialogHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '20px 22px 16px',
  borderBottom: '1px solid var(--border)',
} as const;

const dialogAvatar = {
  display: 'grid',
  placeItems: 'center',
  width: 38,
  height: 38,
  flexShrink: 0,
  borderRadius: 10,
  border: '1px solid var(--border2)',
  background: 'var(--surface2)',
  color: 'var(--body2)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 600,
} as const;

const dialogSections = {
  display: 'grid',
  gap: 0,
} as const;

const dialogSection = {
  padding: '16px 22px',
  borderBottom: '1px solid var(--border)',
} as const;

const dialogSectionTitle = {
  margin: '0 0 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--faint)',
} as const;

const formGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '12px 12px',
} as const;

const fieldLabel = {
  display: 'block',
} as const;

const fullWidthFieldLabel = {
  ...fieldLabel,
  gridColumn: '1 / -1',
} as const;

const inputStyle = {
  width: '100%',
  marginTop: 4,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border2)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
  transition: 'border-color 160ms ease, background 160ms ease',
} as const;

const notesInputStyle = {
  ...inputStyle,
  minHeight: 96,
  resize: 'vertical' as const,
};

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

const heroActionButton = {
  borderColor: 'var(--accentBorder)',
  background: 'color-mix(in srgb, var(--pop) 60%, transparent)',
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

const dangerGhostButton = {
  ...ghostButton,
  border: '1px solid color-mix(in srgb, var(--error) 32%, var(--border2))',
  color: 'var(--error)',
} as const;

const dialogActions = {
  position: 'sticky',
  bottom: 0,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '14px 22px',
  background: 'var(--pop)',
} as const;

const overlay = {
  position: 'fixed' as const,
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0,0,0,0.55)',
  zIndex: 50,
};
