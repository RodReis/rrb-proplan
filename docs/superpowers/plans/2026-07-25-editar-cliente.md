# Editar Cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar edição de cliente na tela Clientes e expor todos os campos do modelo `Client` já suportados pela API.

**Architecture:** Reusar o modal atual como formulário único de criar/editar. O container `ClientsPage` continua dono de busca, carregamento, criação, edição e remoção; o formulário fica no mesmo arquivo porque é UI pequena e já vive ali. Nenhuma rota, dependência ou endpoint novo.

**Tech Stack:** React 18 + Vite + TypeScript + Vitest + React Testing Library; APIs existentes `createClient`, `updateClient`, `listClients`, `deleteClient` em `apps/web/src/lib/api.ts`.

## Global Constraints

- Idioma de UI e docs: pt-BR.
- Código e identificadores: inglês.
- Sem dependência nova.
- Sem backend novo: usar `createClient()` e `updateClient()` existentes.
- Sem mock de produto; testes podem mockar fronteira de API.
- Mudança cirúrgica em `ClientsPage.tsx`.
- Imutabilidade em updates de estado/form.

---

## File Structure

- Modify: `apps/web/src/pages/clients/ClientsPage.tsx`
  - Adicionar `updateClient` ao import.
  - Trocar `creating: boolean` por `editingClient: Client | null` + modo derivado no modal.
  - Renomear `NewClientDialog` para `ClientDialog`.
  - Adicionar campos `cpf`, `phone`, `whatsapp`, `zipCode`, `street`, `district`, `city`, `state`, `notes` ao formulário.
  - Adicionar botão `Editar` nos cards quando `canWrite`.
  - Mostrar telefone/WhatsApp na linha resumo.
- Create: `apps/web/src/pages/clients/ClientsPage.test.tsx`
  - Testar criar com telefone.
  - Testar editar cliente existente chamando `updateClient`.
  - Testar viewer sem botões de escrita.
- Modify: `docs/DEVELOPMENT.md` e `docs/STATUS.md` somente se esta entrega mudar status rastreável da fatia.

---

### Task 1: Cobrir comportamento do formulário de cliente

**Files:**
- Create: `apps/web/src/pages/clients/ClientsPage.test.tsx`
- Test: `apps/web/src/pages/clients/ClientsPage.test.tsx`

**Interfaces:**
- Consumes: `ClientsPage({ canWrite }: { canWrite: boolean })`
- Produces: testes que falham antes da implementação e passam depois.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../../lib/api';
import { ClientsPage } from './ClientsPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiMock = vi.hoisted(() => ({
  listClients: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const client: Client = {
  id: 'c1',
  name: 'Rodrigo Reis Barros',
  cpf: '12345678900',
  company: 'RRB TRADING LTDA',
  cnpj: '11222333000144',
  email: 'rodreisb@gmail.com',
  phone: '11999990000',
  whatsapp: '11988880000',
  zipCode: '01001000',
  street: 'Praça da Sé',
  district: 'Sé',
  city: 'São Paulo',
  state: 'SP',
  notes: 'Cliente prioritário',
  createdAt: '2026-07-25T00:00:00.000Z',
};

function renderPage(canWrite = true) {
  return render(
    <MemoryRouter initialEntries={['/t/rodreisb/clients']}>
      <Routes>
        <Route path="/t/:tenant/clients" element={<ClientsPage canWrite={canWrite} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ClientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.listClients.mockResolvedValue([client]);
    apiMock.createClient.mockResolvedValue(client);
    apiMock.updateClient.mockResolvedValue(client);
    apiMock.deleteClient.mockResolvedValue({ deleted: true });
  });

  it('cria cliente com telefone e WhatsApp', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '+ Novo cliente' }));
    await user.type(screen.getByLabelText('Nome *'), 'Maria Cliente');
    await user.type(screen.getByLabelText('Telefone'), '11911112222');
    await user.type(screen.getByLabelText('WhatsApp'), '11933334444');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() =>
      expect(apiMock.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Maria Cliente',
          phone: '11911112222',
          whatsapp: '11933334444',
        }),
      ),
    );
  });

  it('edita cliente existente usando PATCH', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    const phone = screen.getByLabelText('Telefone');
    await user.clear(phone);
    await user.type(phone, '11955556666');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(apiMock.updateClient).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ phone: '11955556666' }),
      ),
    );
  });

  it('não mostra ações de escrita para viewer', async () => {
    renderPage(false);

    expect(await screen.findByText('Rodrigo Reis Barros')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Novo cliente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @proplan/web test -- ClientsPage.test.tsx`

Expected: FAIL porque `Editar` não existe e campos `Telefone`/`WhatsApp` não existem no modal.

---

### Task 2: Implementar formulário único criar/editar

**Files:**
- Modify: `apps/web/src/pages/clients/ClientsPage.tsx`
- Test: `apps/web/src/pages/clients/ClientsPage.test.tsx`

**Interfaces:**
- Consumes: `createClient(input: Partial<Client>)`, `updateClient(id: string, input: Partial<Client>)`
- Produces: `ClientDialog` com props `{ client?: Client; onCancel: () => void; onSubmit: (input: Partial<Client>) => void }`

- [ ] **Step 1: Importar updateClient e trocar estado de modal**

```tsx
import {
  createClient,
  deleteClient,
  listClients,
  updateClient,
  type Client,
} from '../../lib/api';
```

Substituir:

```tsx
const [creating, setCreating] = useState(false);
```

por:

```tsx
const [editingClient, setEditingClient] = useState<Client | null>(null);
```

- [ ] **Step 2: Adicionar handlers de criar/editar**

```tsx
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
```

- [ ] **Step 3: Trocar botões do card**

```tsx
{canWrite && (
  <div style={{ display: 'flex', gap: 8 }}>
    <button onClick={() => setEditingClient(client)} style={ghostButton}>
      Editar
    </button>
    <button onClick={() => setConfirmDelete(client)} style={ghostButton}>
      Remover
    </button>
  </div>
)}
```

- [ ] **Step 4: Mostrar telefone/WhatsApp no resumo**

```tsx
{[client.company, client.email, client.whatsapp || client.phone]
  .filter(Boolean)
  .join(' · ') || 'sem contato cadastrado'}
```

- [ ] **Step 5: Trocar render do modal**

```tsx
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
```

Botão `+ Novo cliente` deve usar objeto vazio tipado:

```tsx
<button onClick={() => setEditingClient(emptyClient)} style={primaryButton}>
  + Novo cliente
</button>
```

Adicionar perto dos helpers:

```tsx
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
```

- [ ] **Step 6: Substituir `NewClientDialog` por `ClientDialog`**

```tsx
type ClientForm = Pick<
  Client,
  | 'name'
  | 'cpf'
  | 'company'
  | 'cnpj'
  | 'email'
  | 'phone'
  | 'whatsapp'
  | 'zipCode'
  | 'street'
  | 'district'
  | 'city'
  | 'state'
  | 'notes'
>;

const CLIENT_FIELDS: { key: keyof ClientForm; label: string; required?: boolean; multiline?: boolean }[] = [
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

function toForm(client: Client): ClientForm {
  return {
    name: client.name,
    cpf: client.cpf ?? '',
    company: client.company ?? '',
    cnpj: client.cnpj ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    whatsapp: client.whatsapp ?? '',
    zipCode: client.zipCode ?? '',
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
```

Implementar `ClientDialog`:

```tsx
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

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={isEditing ? 'Editar cliente' : 'Novo cliente'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) onSubmit(cleanForm(form));
        }}
        style={dialogPanel}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 17, color: 'var(--text)' }}>
          {isEditing ? 'Editar cliente' : 'Novo cliente'}
        </h2>

        <div style={formGrid}>
          {CLIENT_FIELDS.map((field) => (
            <label key={field.key} style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
                {field.label}{field.required && ' *'}
              </span>
              {field.multiline ? (
                <textarea
                  value={form[field.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }}
                />
              ) : (
                <input
                  value={form[field.key] ?? ''}
                  required={field.required}
                  aria-label={`${field.label}${field.required ? ' *' : ''}`}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  style={inputStyle}
                />
              )}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onCancel} style={ghostButton}>Cancelar</button>
          <button type="submit" style={primaryButton}>{isEditing ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    </div>
  );
}
```

Adicionar estilos:

```tsx
const dialogPanel = {
  width: 'min(720px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 32px)',
  overflow: 'auto',
  padding: 22,
  borderRadius: 12,
  background: 'var(--pop)',
  border: '1px solid var(--border3)',
} as const;

const formGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0 12px',
} as const;

const inputStyle = {
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: 7,
  border: '1px solid var(--border2)',
  background: 'var(--surface)',
  color: 'var(--text)',
} as const;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @proplan/web test -- ClientsPage.test.tsx`

Expected: PASS.

---

### Task 3: Verificar build e documentação de entrega

**Files:**
- Modify: `docs/DEVELOPMENT.md` se houver checklist da fatia Clientes ainda pendente.
- Modify: `docs/STATUS.md` se status da fatia mudar.
- Local only: `graphify-out/` via `/graphify . --update` ao final; não commitar.

**Interfaces:**
- Consumes: código e testes verdes das tarefas 1-2.
- Produces: entrega verificável e docs alinhados quando aplicável.

- [ ] **Step 1: Run focused test**

Run: `pnpm --filter @proplan/web test -- ClientsPage.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run web build**

Run: `pnpm --filter @proplan/web build`

Expected: PASS.

- [ ] **Step 3: Run graphify incremental**

Run: `/graphify . --update`

Expected: graph updated locally under `graphify-out/`.

- [ ] **Step 4: Review diff**

Run: `git diff -- apps/web/src/pages/clients/ClientsPage.tsx apps/web/src/pages/clients/ClientsPage.test.tsx docs/DEVELOPMENT.md docs/STATUS.md`

Expected: only client UI/test/docs changes.

- [ ] **Step 5: Commit only if user asks**

Commit message if requested:

```bash
git add apps/web/src/pages/clients/ClientsPage.tsx apps/web/src/pages/clients/ClientsPage.test.tsx docs/DEVELOPMENT.md docs/STATUS.md
git commit -m "clients: adiciona edição completa de cliente"
```

## Self-Review

- Spec coverage: editar cliente, telefone, WhatsApp, endereço completo e notas cobertos em Task 2; criação e edição cobertas em Task 1.
- Placeholder scan: sem TBD/TODO/implement later.
- Type consistency: `ClientForm`, `ClientDialog`, `createClient`, `updateClient` nomes consistentes com `api.ts`.
- Scope kept lazy: sem endpoint, lib, rota, drawer ou abstração nova.
