import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ContractDetail,
  ContractSummary,
  ProviderProfileView,
  TemplateSummary,
} from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listContracts: vi.fn(),
  getContract: vi.fn(),
  issueContract: vi.fn(),
  getContractLink: vi.fn(),
  createContractLink: vi.fn(),
  revokeContractLink: vi.fn(),
  acceptContract: vi.fn(),
  listContractTemplates: vi.fn(),
  getProviderProfile: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { ContractsPanel } = await import('./ContractsPanel');

/** Casa o parágrafo inteiro, ignorando quebras que o `<strong>` introduz. */
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
    isSeedExample: false,
    currentVersion: 2,
    updatedAt: '2026-07-28T12:00:00.000Z',
    readyToIssue: true,
  },
];

const RESUMO: ContractSummary = {
  id: 'c1',
  version: 1,
  modality: 'desenvolvimento',
  budgetBrl: '12500.00',
  effortHours: '80.00',
  paymentTerms: null,
  templateVersion: 2,
  estimateVersion: 1,
  acceptedAt: null,
  createdAt: '2026-07-28T12:00:00.000Z',
};

const DETALHE: ContractDetail = {
  ...RESUMO,
  renderedHtml: '<h1>Contrato</h1><p>Bar &amp; Cia</p>',
  providerSnapshot: { legalName: 'Acme ME' },
  clientSnapshot: { legalName: 'Cliente Ltda' },
};

function montar() {
  return render(
    <ContractsPanel projectId="p1" projectTitle="Projeto EPG2" onClose={vi.fn()} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listContracts.mockResolvedValue([RESUMO]);
  apiMock.getContract.mockResolvedValue(DETALHE);
  apiMock.listContractTemplates.mockResolvedValue(TEMPLATES);
  apiMock.getProviderProfile.mockResolvedValue(PERFIL);
  apiMock.getContractLink.mockResolvedValue({ active: false });
});

/**
 * Painel de contratos (SPEC-034 §2.13).
 *
 * O que estes testes protegem, em ordem de importância:
 *
 *   - **emitir não move o card, o aceite move** (§2.6) — se a tela igualasse os
 *     dois atos, a decisão do PI viraria ambígua na prática;
 *   - **o aceite não se apresenta como assinatura** (§3) — a spec diz que a UI
 *     não deve sugerir o contrário em lugar nenhum;
 *   - **o aviso de dado pessoal aparece ANTES do link**, não abaixo dele — a
 *     SPEC-031 já pagou esse defeito uma vez, com um aviso invisível;
 *   - **o selo "aceito" é por versão**, nunca do projeto.
 */
describe('ContractsPanel', () => {
  it('diz que emitir NÃO move o card', async () => {
    montar();
    expect(
      await screen.findByText(textoDe(/emitir não move o card/i)),
    ).toBeInTheDocument();
  });

  it('diz que o aceite é registro, e não assinatura eletrônica', async () => {
    montar();
    // Sem esta frase, "Registrar aceite" ao lado de um contrato é lido como
    // assinatura — que é exatamente o que o §3 põe fora de escopo.
    expect(
      await screen.findByText(textoDe(/não é assinatura eletrônica/i)),
    ).toBeInTheDocument();
  });

  it('avisa sobre os dados pessoais ANTES de oferecer o link', async () => {
    const { container } = montar();
    const aviso = await screen.findByText(
      textoDe(/CPF\/CNPJ e endereço completos das duas partes/i),
    );
    const botao = await screen.findByRole('button', { name: /gerar link/i });

    // `compareDocumentPosition` em vez de "existe na tela": a SPEC-031 mostrou
    // que presença não basta — o aviso estava lá, no rodapé que ninguém rola.
    expect(
      aviso.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it('não oferece cópia enquanto o token em claro não existe', async () => {
    montar();
    await screen.findByRole('button', { name: /gerar link/i });
    // O token só volta do POST, uma única vez. Oferecer "copiar" sem ele seria
    // oferecer uma URL que não existe.
    expect(screen.queryByRole('button', { name: /copiar link/i })).toBeNull();
  });

  it('mostra a URL da API depois de gerar, e avisa que não é recuperável', async () => {
    apiMock.createContractLink.mockResolvedValue({
      id: 'l1',
      token: 'tok-abc',
      expiresAt: '2026-07-30T12:00:00.000Z',
    });
    montar();

    await userEvent.click(await screen.findByRole('button', { name: /gerar link/i }));

    const campo = await screen.findByDisplayValue(/\/c\/tok-abc$/);
    // Aponta para a API (que serve o HTML), nunca para o web: `/c/:token` não é
    // rota React, e sobre `window.location.origin` cairia no catálogo.
    expect((campo as HTMLInputElement).value).toContain('/c/tok-abc');
    expect(
      screen.getByText(textoDe(/não é recuperável depois que a tela recarregar/i)),
    ).toBeInTheDocument();
  });

  it('pede confirmação antes de regenerar sobre link válido', async () => {
    apiMock.getContractLink.mockResolvedValue({
      active: true,
      id: 'l1',
      expiresAt: '2026-07-30T12:00:00.000Z',
      createdAt: '2026-07-28T12:00:00.000Z',
      status: 'valid',
    });
    montar();

    await userEvent.click(
      await screen.findByRole('button', { name: /regenerar link/i }),
    );

    expect(
      screen.getByText(textoDe(/o link atual deixa de funcionar/i)),
    ).toBeInTheDocument();
    // Confirmação pendente ⇒ nada foi criado ainda.
    expect(apiMock.createContractLink).not.toHaveBeenCalled();
  });

  it('bloqueia emitir quando o template ainda é o semeado, com o motivo do §2.3', async () => {
    apiMock.listContractTemplates.mockResolvedValue([
      { ...TEMPLATES[0], isSeedExample: true, readyToIssue: false },
    ]);
    montar();

    expect(
      await screen.findByText(/edite e salve o template desta modalidade/i),
    ).toBeInTheDocument();
    expect(
      (await screen.findByRole('button', { name: /emitir nova versão/i })),
    ).toBeDisabled();
  });

  it('bloqueia emitir sem perfil do prestador preenchido', async () => {
    apiMock.getProviderProfile.mockResolvedValue({ ...PERFIL, exists: false });
    montar();

    expect(
      await screen.findByText(/preencha o perfil do prestador/i),
    ).toBeInTheDocument();
  });

  it('registra o aceite com o canal escolhido e avisa que o card avançou', async () => {
    apiMock.acceptContract.mockResolvedValue({
      accepted: true,
      cardMoved: true,
      alreadyAccepted: false,
    });
    const onCardMoved = vi.fn();
    render(
      <ContractsPanel
        projectId="p1"
        projectTitle="Projeto EPG2"
        onClose={vi.fn()}
        onCardMoved={onCardMoved}
      />,
    );

    await userEvent.selectOptions(
      await screen.findByLabelText(/como o cliente aceitou/i),
      'whatsapp',
    );
    await userEvent.click(screen.getByRole('button', { name: /registrar aceite/i }));

    await waitFor(() =>
      expect(apiMock.acceptContract).toHaveBeenCalledWith('c1', {
        channel: 'whatsapp',
        note: undefined,
      }),
    );
    expect(onCardMoved).toHaveBeenCalled();
  });

  it('`cardMoved: false` não é erro — o aceite foi gravado do mesmo jeito', async () => {
    apiMock.acceptContract.mockResolvedValue({
      accepted: true,
      cardMoved: false,
      alreadyAccepted: false,
    });
    const onCardMoved = vi.fn();
    render(
      <ContractsPanel
        projectId="p1"
        projectTitle="Projeto EPG2"
        onClose={vi.fn()}
        onCardMoved={onCardMoved}
      />,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: /registrar aceite/i }),
    );

    await waitFor(() => expect(apiMock.acceptContract).toHaveBeenCalled());
    // A máquina de estados pode recusar (card já adiante) sem que isso apague o
    // ato: nenhum erro em tela, e o funil não é mandado recarregar à toa.
    expect(screen.queryByText(/a ação falhou/i)).toBeNull();
    expect(onCardMoved).not.toHaveBeenCalled();
  });

  it('contrato já aceito troca o formulário pela data, e diz que o link segue valendo', async () => {
    apiMock.getContract.mockResolvedValue({
      ...DETALHE,
      acceptedAt: '2026-07-28T13:00:00.000Z',
    });
    montar();

    expect(await screen.findByText(/aceito em/i)).toBeInTheDocument();
    expect(
      screen.getByText(textoDe(/o link continua válido até expirar/i)),
    ).toBeInTheDocument();
    // Aceitar duas vezes pela tela não faz sentido: o ato já aconteceu.
    expect(screen.queryByRole('button', { name: /registrar aceite/i })).toBeNull();
  });

  it('não reescapa o HTML do contrato — o painel mostra o mesmo documento que o cliente lê', async () => {
    montar();
    await userEvent.click(await screen.findByText(/ver o documento/i));

    // `Bar &amp; Cia` no payload é `Bar & Cia` na tela. Se o painel reescapasse,
    // apareceria `Bar &amp; Cia` literal — documento diferente do público.
    await waitFor(() =>
      expect(screen.getByText(/Bar & Cia/)).toBeInTheDocument(),
    );
  });

  it('mostra valor e horas como vieram, sem refazer conta', async () => {
    montar();
    expect(await screen.findByText(/12\.500,00/)).toBeInTheDocument();
    expect(screen.getByText('80 h')).toBeInTheDocument();
  });
});
