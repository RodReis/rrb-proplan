import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../theme';
import type { LicProductView, LicReleaseView } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listLicReleases: vi.fn(),
  createLicRelease: vi.fn(),
  unpublishLicRelease: vi.fn(),
  publishLicRelease: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ReleasesPanel } = await import('./ReleasesPanel');

const SHA = 'a'.repeat(64);

const PRODUTO = {
  id: 'prod-1',
  slug: 'warroom',
  name: 'War Room',
  keyPrefix: 'WR',
  sourceRepo: null,
  editions: [],
} as unknown as LicProductView;

const RELEASE: LicReleaseView = {
  id: 'rel-1',
  productId: 'prod-1',
  version: '1.2.0',
  os: 'win-x64',
  releasedAt: '2026-06-01T00:00:00.000Z',
  assetId: '12345',
  sha256: SHA,
  notes: null,
  published: true,
};

function montar(produtos: LicProductView[] = [PRODUTO]) {
  return render(
    <ThemeProvider>
      <ReleasesPanel produtos={produtos} />
    </ThemeProvider>,
  );
}

describe('ReleasesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.listLicReleases.mockResolvedValue([]);
  });

  it('lista vazia explica a consequência, não só diz "vazio"', async () => {
    montar();

    // Sem release registrada o `update` responde "não há atualização" mesmo
    // havendo release no GitHub — e esse é exatamente o estado que parece
    // funcionar e não funciona. Dizer só "nenhuma versão" esconderia isso.
    await waitFor(() =>
      expect(screen.getByText(/responde que não há atualização/i)).toBeInTheDocument(),
    );
  });

  it('mostra versão, plataforma e estado de publicação', async () => {
    apiMock.listLicReleases.mockResolvedValue([RELEASE]);
    montar();

    await waitFor(() => expect(screen.getByText('1.2.0')).toBeInTheDocument());
    expect(screen.getByText('win-x64')).toBeInTheDocument();
    expect(screen.getByText('Publicada')).toBeInTheDocument();
  });

  it('o hash completo fica no `title`, apesar de abreviado na lista', async () => {
    apiMock.listLicReleases.mockResolvedValue([RELEASE]);
    montar();

    // Conferir hash é comparar caractere a caractere: uma tela que só mostra 12
    // deles torna a conferência impossível.
    await waitFor(() => expect(screen.getByTitle(SHA)).toBeInTheDocument());
  });

  it('o botão de registrar fica desabilitado sem produto cadastrado', async () => {
    montar([]);

    // Release pendura no produto. Sem produto, o formulário não teria o que
    // preencher no campo obrigatório — e o POST falharia com 422.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /registrar versão/i })).toBeDisabled(),
    );
  });

  it('não envia com `sha256` malformado, e diz por quê', async () => {
    montar();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText(/Versões publicadas/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /registrar versão/i }));

    await user.type(screen.getByLabelText(/^Versão$/i), '1.3.0');
    await user.type(screen.getByLabelText(/ID do asset/i), '999');
    await user.type(screen.getByLabelText(/SHA-256/i), 'abc');

    // O aviso aparece **antes** do POST: hash torto aceito pelos dois lados só
    // apareceria na máquina do cliente, depois de 80 MB baixados, como
    // "download corrompido".
    expect(screen.getByText(/64 dígitos hexadecimais/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /registrar versão/i }).at(-1),
    ).toBeDisabled();
    expect(apiMock.createLicRelease).not.toHaveBeenCalled();
  });

  it('registra convertendo a data informada, nunca "hoje"', async () => {
    apiMock.createLicRelease.mockResolvedValue({ ...RELEASE, version: '1.3.0' });
    montar();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText(/Versões publicadas/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /registrar versão/i }));

    await user.type(screen.getByLabelText(/^Versão$/i), '1.3.0');
    await user.type(screen.getByLabelText(/Data de publicação/i), '2026-03-01');
    await user.type(screen.getByLabelText(/ID do asset/i), '999');
    await user.type(screen.getByLabelText(/SHA-256/i), SHA);

    await user.click(screen.getAllByRole('button', { name: /registrar versão/i }).at(-1)!);

    // A data vai como o operador informou. Assumir `now()` tornaria uma release
    // antiga indevidamente autorizada para quem já tem a janela vencida.
    await waitFor(() => expect(apiMock.createLicRelease).toHaveBeenCalled());
    const enviado = apiMock.createLicRelease.mock.calls[0][0];
    expect(enviado.releasedAt).toContain('2026-03-01');
    expect(enviado.sha256).toBe(SHA);
  });

  it('despublicar diz que a versão some do update dos clientes', async () => {
    apiMock.listLicReleases.mockResolvedValue([RELEASE]);
    apiMock.unpublishLicRelease.mockResolvedValue({ ...RELEASE, published: false });
    const { toast } = await import('sonner');
    montar();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('1.2.0')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /despublicar/i }));

    await waitFor(() => expect(apiMock.unpublishLicRelease).toHaveBeenCalledWith('rel-1'));
    // A confirmação nomeia a consequência real. "Removida" faria o operador
    // acreditar que o binário saiu de circulação — ele continua no GitHub.
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/some do update/i),
    );
  });

  it('despublicada oferece republicar', async () => {
    apiMock.listLicReleases.mockResolvedValue([{ ...RELEASE, published: false }]);
    montar();

    // Despublicar por engano é o erro provável de um botão ao lado da lista, e
    // sem volta o operador teria de registrar a mesma versão de novo — que o
    // `@@unique` recusa.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /republicar/i })).toBeInTheDocument(),
    );
    expect(screen.getByText('Despublicada')).toBeInTheDocument();
  });
});
