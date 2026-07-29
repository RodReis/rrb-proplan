import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../theme';
import type {
  ProviderProfileView,
  TemplateDetail,
  TemplateSummary,
} from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  getProviderProfile: vi.fn(),
  saveProviderProfile: vi.fn(),
  listContractTemplates: vi.fn(),
  getContractTemplate: vi.fn(),
  saveContractTemplateVersion: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ContractSettingsPage } = await import('./ContractSettingsPage');

function textoDe(regex: RegExp) {
  return (_conteudo: string, elemento: Element | null) => {
    if (!elemento) return false;
    const proprio = regex.test(elemento.textContent ?? '');
    const doFilho = Array.from(elemento.children).some((f) =>
      regex.test(f.textContent ?? ''),
    );
    return proprio && !doFilho;
  };
}

const PERFIL: ProviderProfileView = {
  legalName: 'Acme ME',
  documentType: 'cnpj',
  document: '11.222.333/0001-44',
  zipCode: null,
  street: null,
  district: null,
  city: null,
  state: null,
  email: null,
  phone: null,
  canEdit: true,
  exists: true,
};

const TEMPLATES: TemplateSummary[] = [
  {
    modality: 'desenvolvimento',
    isSeedExample: true,
    currentVersion: 1,
    updatedAt: '2026-07-28T12:00:00.000Z',
    readyToIssue: false,
  },
  {
    modality: 'desenvolvimento_manutencao',
    isSeedExample: false,
    currentVersion: 3,
    updatedAt: '2026-07-28T12:00:00.000Z',
    readyToIssue: true,
  },
];

const DETALHE: TemplateDetail = {
  ...TEMPLATES[0],
  body: '## 1. Das partes\n\n{{provider_name}} e {{client_name}}.',
  canEdit: true,
};

function montar() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/t/acme/clients/contratos']}>
        <Routes>
          <Route
            path="/t/:tenant/clients/contratos"
            element={<ContractSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.getProviderProfile.mockResolvedValue(PERFIL);
  apiMock.listContractTemplates.mockResolvedValue(TEMPLATES);
  apiMock.getContractTemplate.mockResolvedValue(DETALHE);
});

/**
 * Perfil do prestador e modelos de contrato (SPEC-034 §2.1–§2.3).
 *
 * O que estes testes protegem:
 *
 *   - **a trava do §2.3 é visível ANTES de emitir** — o aviso do template
 *     semeado é o que impede o produto de virar fonte de minuta jurídica sem
 *     advogado por trás (§7.3);
 *   - **salvar cria versão nova**, e a tela diz isso — "Salvar" sozinho sugere
 *     sobrescrita, e um contrato emitido apontando para a versão anterior
 *     pareceria ter mudado;
 *   - **quem não é `owner` lê, mas não escreve** — e é o servidor que decide,
 *     via `canEdit`.
 */
describe('ContractSettingsPage', () => {
  it('mostra o perfil do prestador carregado', async () => {
    montar();
    expect(await screen.findByDisplayValue('Acme ME')).toBeInTheDocument();
  });

  it('avisa que o perfil identifica você como parte quando ainda não existe', async () => {
    apiMock.getProviderProfile.mockResolvedValue({ ...PERFIL, exists: false });
    montar();
    expect(
      await screen.findByText(textoDe(/identifica você como parte no contrato/i)),
    ).toBeInTheDocument();
  });

  it('não deixa salvar o perfil sem nome nem documento', async () => {
    apiMock.getProviderProfile.mockResolvedValue({
      ...PERFIL,
      legalName: '',
      document: '',
      exists: false,
    });
    montar();
    expect(
      await screen.findByRole('button', { name: /salvar perfil/i }),
    ).toBeDisabled();
  });

  it('salva o perfil por inteiro (PUT), como o servidor espera', async () => {
    apiMock.saveProviderProfile.mockResolvedValue(PERFIL);
    montar();

    await userEvent.click(await screen.findByRole('button', { name: /salvar perfil/i }));

    await waitFor(() =>
      expect(apiMock.saveProviderProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          legalName: 'Acme ME',
          documentType: 'cnpj',
          document: '11.222.333/0001-44',
        }),
      ),
    );
  });

  it('quem não é owner vê o perfil, mas não o botão de salvar', async () => {
    apiMock.getProviderProfile.mockResolvedValue({ ...PERFIL, canEdit: false });
    montar();

    expect(await screen.findByDisplayValue('Acme ME')).toBeInTheDocument();
    expect(
      screen.getByText(/só o dono do workspace altera o perfil/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /salvar perfil/i })).toBeNull();
  });

  it('avisa que o template semeado precisa ser editado antes do 1º contrato', async () => {
    montar();
    await userEvent.click(
      await screen.findByRole('tab', { name: /modelos de contrato/i }),
    );

    expect(
      await screen.findByText(textoDe(/edite e salve antes de emitir o primeiro contrato/i)),
    ).toBeInTheDocument();
  });

  it('o botão diz "Salvar como versão nova", nunca só "Salvar"', async () => {
    montar();
    await userEvent.click(
      await screen.findByRole('tab', { name: /modelos de contrato/i }),
    );

    // "Salvar" sozinho sugere sobrescrita — e o texto anterior continua legível
    // porque um contrato emitido aponta para ele.
    expect(
      await screen.findByRole('button', { name: /salvar como versão nova/i }),
    ).toBeInTheDocument();
  });

  it('salva o corpo editado como versão nova', async () => {
    apiMock.saveContractTemplateVersion.mockResolvedValue({
      ...DETALHE,
      currentVersion: 2,
      isSeedExample: false,
      readyToIssue: true,
    });
    montar();
    await userEvent.click(
      await screen.findByRole('tab', { name: /modelos de contrato/i }),
    );

    const editor = await screen.findByLabelText(/corpo do template de desenvolvimento/i);
    await userEvent.clear(editor);
    // `{{` é sintaxe do `user-event` (chave de escape) e seria consumida —
    // duplicar produz o `{{` literal que o template de verdade tem.
    await userEvent.type(editor, 'Novo texto {{{{client_name}}');
    await userEvent.click(
      screen.getByRole('button', { name: /salvar como versão nova/i }),
    );

    await waitFor(() =>
      expect(apiMock.saveContractTemplateVersion).toHaveBeenCalledWith(
        'desenvolvimento',
        'Novo texto {{client_name}}',
      ),
    );
  });

  it('lista os 12 placeholders aceitos ao lado do editor', async () => {
    montar();
    await userEvent.click(
      await screen.findByRole('tab', { name: /modelos de contrato/i }),
    );

    expect(
      await screen.findByText(/campos que o contrato preenche \(12\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText('{{effort_hours}}')).toBeInTheDocument();
    // Removido por emenda do PI (§8.7): o Estimate entrega horas, não dias.
    expect(screen.queryByText('{{duration_days}}')).toBeNull();
  });

  it('quem não é owner vê o texto do modelo, mas não pode salvá-lo', async () => {
    apiMock.getContractTemplate.mockResolvedValue({ ...DETALHE, canEdit: false });
    montar();
    await userEvent.click(
      await screen.findByRole('tab', { name: /modelos de contrato/i }),
    );

    expect(
      await screen.findByText(/só o dono do workspace altera os modelos/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /salvar como versão nova/i }),
    ).toBeNull();
  });

  it('marca com "exemplo" só a modalidade ainda semeada', async () => {
    montar();
    await userEvent.click(
      await screen.findByRole('tab', { name: /modelos de contrato/i }),
    );

    // Casa pelo `textContent` e não pelo nome acessível: o RTL normaliza os
    // espaços em volta do `·`, e um `^...$` sobre o nome quebraria a cada ajuste
    // de espaçamento sem que nada da tela tivesse mudado de fato.
    const semeado = await screen.findByRole('button', {
      name: (_n, el) => /Desenvolvimento\s*·\s*exemplo/.test(el.textContent ?? ''),
    });
    expect(semeado).toBeInTheDocument();

    // A que já foi salva pelo prestador NÃO leva o selo — é essa a distinção
    // que a trava do §2.3 depende de mostrar.
    const salva = screen.getByRole('button', {
      name: (_n, el) => (el.textContent ?? '').startsWith('Desenvolvimento + manutenção'),
    });
    expect(salva.textContent).not.toMatch(/exemplo/);
  });
});
