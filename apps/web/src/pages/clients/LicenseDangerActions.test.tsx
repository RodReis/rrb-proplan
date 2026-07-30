import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseDetail } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  extendLicense: vi.fn(),
  anonymizeLicense: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { LicenseDangerActions } = await import('./LicenseDangerActions');

const LICENCA: LicenseDetail = {
  id: 'lic-1',
  status: 'ACTIVE',
  customerEmail: 'ana@exemplo.com',
  customerName: 'Ana Silva',
  editionSlug: 'source',
  editionName: 'Com código-fonte',
  productSlug: 'warroom',
  issuedAt: '2026-07-01T12:00:00Z',
  updatesUntil: '2027-07-01T12:00:00Z',
  expiresAt: '2026-08-30T00:00:00Z',
  revokedAt: null,
  revokedReason: null,
  activeMachines: 1,
  maxMachines: 2,
  activations: [],
  swapCount: 0,
  swapWindowDays: 30,
  sourceAccess: 'ACTIVE',
  githubUsername: 'anasilva',
  sourceAccessError: null,
  sourceInviteAt: '2026-07-09T12:00:00Z',
  saleRef: 'kiwify-9931',
  pastDueAt: null,
  mailDeliveries: [],
  events: [],
};

function montar(licenca: LicenseDetail = LICENCA) {
  const onMudou = vi.fn();
  render(<LicenseDangerActions licenca={licenca} onMudou={onMudou} />);
  return { onMudou };
}

describe('SPEC-040: estender a validade', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AVISA da sobrescrita antes da confirmação, não depois', async () => {
    // A decisão PI #2 em uma linha. `expiresAt` tem uma autoridade — a
    // plataforma —, e a próxima renovação desfaz esta data. O operador precisa
    // saber ANTES de prometer ao cliente; descobrir depois que a data voltou
    // sozinha é o desfecho que este aviso existe para impedir.
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Estender validade/ }));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(/próxima renovação da plataforma sobrescreve/i);
    // O aviso aparece junto com o formulário, antes de qualquer submissão.
    expect(apiMock.extendLicense).not.toHaveBeenCalled();
  });

  it('mostra a validade atual, para o operador comparar', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Estender validade/ }));
    expect(await screen.findByText(/Hoje vale até 2026-08-30/)).toBeInTheDocument();
  });

  it('o botão fica inerte sem data OU sem motivo', async () => {
    // A tela evita a ida inútil; o servidor é quem garante. Extensão sem motivo
    // é a que ninguém consegue explicar quando o cliente cobra o prometido.
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Estender validade/ }));

    const confirmar = await screen.findByRole('button', {
      name: 'Confirmar extensão',
    });
    expect(confirmar).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Motivo/), 'cortesia');
    expect(confirmar).toBeDisabled();
  });

  it('envia data e motivo, e avisa o valor anterior no sucesso', async () => {
    apiMock.extendLicense.mockResolvedValue({
      id: 'lic-1',
      expiresAt: '2026-12-31T00:00:00.000Z',
      previousExpiresAt: '2026-08-30T00:00:00.000Z',
    });
    const { onMudou } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Estender validade/ }));

    await userEvent.type(await screen.findByLabelText(/Nova validade/), '2026-12-31');
    await userEvent.type(screen.getByLabelText(/Motivo/), 'cortesia por suporte');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar extensão' }));

    await waitFor(() =>
      expect(apiMock.extendLicense).toHaveBeenCalledWith('lic-1', {
        until: '2026-12-31',
        reason: 'cortesia por suporte',
      }),
    );
    // Recarrega a gaveta: a data mudou e a ação virou evento na trilha.
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });
});

describe('SPEC-040: exclusão a pedido', () => {
  beforeEach(() => vi.clearAllMocks());

  it('declara os efeitos ANTES da confirmação', async () => {
    // §Exclusão a pedido: descobrir depois que a licença parou de receber
    // e-mail transformaria o direito do titular em incidente de suporte.
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Excluir dados a pedido/ }));

    expect(await screen.findByText(/não tem volta/i)).toBeInTheDocument();
    expect(screen.getByText(/não recebe mais\s+e-mail/i)).toBeInTheDocument();
    expect(screen.getByText(/reemissão de chave/i)).toBeInTheDocument();
  });

  it('declara o que PERMANECE — a licença, a trilha e a venda', async () => {
    // A distinção é a ação inteira: apagar a linha atenderia ao pedido e
    // destruiria a prova da transação, inclusive a prova de que a exclusão
    // aconteceu. Uma tela que não dissesse isso sugeriria "delete".
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Excluir dados a pedido/ }));

    const bloco = await screen.findByText(/O que permanece/);
    expect(bloco.parentElement).toHaveTextContent(/trilha/i);
    expect(bloco.parentElement).toHaveTextContent(/referência da venda/i);
  });

  it('diz que o ACESSO AO CÓDIGO continua — a compra não é desfeita', async () => {
    // Amarrar LGPD a cancelamento de produto pago seria transformar um direito
    // do titular em punição.
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Excluir dados a pedido/ }));
    expect(await screen.findByText(/continua/)).toBeInTheDocument();
  });

  it('exige DIGITAR o e-mail do titular', async () => {
    // Ação sem volta não acontece por clique errado numa lista.
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Excluir dados a pedido/ }));

    const confirmar = await screen.findByRole('button', {
      name: /Excluir os dados desta licença/,
    });
    await userEvent.type(screen.getByLabelText(/Motivo/), 'pedido do titular');
    expect(confirmar).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/para confirmar/), 'outro@exemplo.com');
    expect(confirmar).toBeDisabled();
  });

  it('e-mail certo com motivo libera a ação', async () => {
    apiMock.anonymizeLicense.mockResolvedValue({
      id: 'lic-1',
      mailDeliveries: 2,
      webhookEvents: 1,
    });
    const { onMudou } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Excluir dados a pedido/ }));

    await userEvent.type(
      await screen.findByLabelText(/para confirmar/),
      'ana@exemplo.com',
    );
    await userEvent.type(screen.getByLabelText(/Motivo/), 'pedido do titular');
    await userEvent.click(
      screen.getByRole('button', { name: /Excluir os dados desta licença/ }),
    );

    await waitFor(() =>
      expect(apiMock.anonymizeLicense).toHaveBeenCalledWith('lic-1', {
        reason: 'pedido do titular',
      }),
    );
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });

  it('aceita o e-mail com caixa trocada', async () => {
    // Confirmação por digitação é para dar uma pausa, não para testar
    // datilografia. Recusar "ANA@exemplo.com" seria burocracia sobre um dado
    // que a pessoa está copiando da tela ao lado.
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Excluir dados a pedido/ }));

    await userEvent.type(
      await screen.findByLabelText(/para confirmar/),
      'ANA@Exemplo.com',
    );
    await userEvent.type(screen.getByLabelText(/Motivo/), 'pedido');
    expect(
      screen.getByRole('button', { name: /Excluir os dados desta licença/ }),
    ).toBeEnabled();
  });
});

describe('SPEC-040: licença já anonimizada', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não oferece nenhuma das duas ações', async () => {
    // O marcador não é destinatário de nada, e "excluir de novo" não tem o que
    // excluir. Oferecer os botões convidaria a uma ação que só produz erro.
    montar({ ...LICENCA, customerEmail: 'anonimizado@removido.local' });

    expect(
      screen.queryByRole('button', { name: /Excluir dados a pedido/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Estender validade/ }),
    ).not.toBeInTheDocument();
  });

  it('diz que os dados saíram e que o resto permanece', async () => {
    montar({ ...LICENCA, customerEmail: 'anonimizado@removido.local' });
    expect(screen.getByText(/excluídos a pedido do titular/)).toBeInTheDocument();
    expect(screen.getByText(/trilha permanecem/)).toBeInTheDocument();
  });
});
