import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantCapsSection } from './Settings';
import { api } from '../lib/api';

/**
 * Teto de gasto de IA na tela (ADR-026).
 *
 * O que estes casos protegem: quem não é `owner` não pode receber um campo
 * editável, porque a API recusa a escrita. Campo que aceita digitação e depois
 * não salva é pior que campo ausente — o usuário sai achando que ajustou o
 * limite.
 */
vi.mock('../lib/api', () => ({
  api: { llmCaps: vi.fn(), updateLlmCaps: vi.fn() },
}));

const caps = (canEditCaps: boolean) => ({
  llmAlertUsdMonthly: '5',
  llmHardCapUsdMonthly: '20',
  canEditCaps,
});

describe('TenantCapsSection (ADR-026)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('owner vê campos editáveis com os valores do tenant', async () => {
    vi.mocked(api.llmCaps).mockResolvedValue(caps(true));
    render(<TenantCapsSection />);

    const inputs = await screen.findAllByRole('spinbutton');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue(5);
    expect(inputs[1]).toHaveValue(20);
  });

  it('não-owner vê os números, não os campos', async () => {
    vi.mocked(api.llmCaps).mockResolvedValue(caps(false));
    render(<TenantCapsSection />);

    expect(await screen.findByText('20')).toBeInTheDocument();
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getByText(/só o dono do workspace altera/i)).toBeInTheDocument();
  });

  it('a tela diz que o teto é do workspace, não da pessoa', async () => {
    vi.mocked(api.llmCaps).mockResolvedValue(caps(true));
    render(<TenantCapsSection />);
    // O texto é o que evita a leitura antiga ("meu teto") sobreviver à mudança.
    expect(await screen.findByText(/vale para todos os membros/i)).toBeInTheDocument();
  });

  it('salva no blur quando o valor muda', async () => {
    vi.mocked(api.llmCaps).mockResolvedValue(caps(true));
    vi.mocked(api.updateLlmCaps).mockResolvedValue({ ...caps(true), llmHardCapUsdMonthly: '30' });
    render(<TenantCapsSection />);

    const inputs = await screen.findAllByRole('spinbutton');
    await userEvent.clear(inputs[1]);
    await userEvent.type(inputs[1], '30');
    await userEvent.tab();

    await waitFor(() =>
      expect(api.updateLlmCaps).toHaveBeenCalledWith({ llmHardCapUsdMonthly: '30' }),
    );
  });

  it('recusa do servidor mostra o erro e recarrega o valor real', async () => {
    vi.mocked(api.llmCaps)
      .mockResolvedValueOnce(caps(true))
      .mockResolvedValueOnce(caps(true));
    vi.mocked(api.updateLlmCaps).mockRejectedValue(new Error('403 sem permissão'));
    render(<TenantCapsSection />);

    const inputs = await screen.findAllByRole('spinbutton');
    await userEvent.clear(inputs[1]);
    await userEvent.type(inputs[1], '999');
    await userEvent.tab();

    // Sem isto, o 999 recusado continuaria na tela como se tivesse valido.
    expect(await screen.findByText(/sem permissão/i)).toBeInTheDocument();
    await waitFor(() => expect(api.llmCaps).toHaveBeenCalledTimes(2));
  });
});
