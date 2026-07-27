import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingVersionDetail, BriefingVersionRef } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  getBriefingVersion: vi.fn(),
  briefingAttachmentUrl: vi.fn((id: string) => `/api/t/t1/files/${id}`),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { BriefingVersionPanel } = await import('./BriefingVersionPanel');

/**
 * Leitura do briefing enviado (SPEC-031 §6).
 *
 * O que estes testes protegem:
 *
 *   - **é leitura, e só**: nenhum campo editável em tela — a versão é imutável
 *     (§5), e um `input` aqui seria a promessa de uma escrita que não existe;
 *   - **o rótulo vence o código**: `G` nunca chega aos olhos de ninguém;
 *   - **a v1 continua legível** depois que a v2 nasce (regenerar o link);
 *   - **etapa não respondida diz "Não informado"** em vez de sumir — ausência é
 *     informação (ADR-014), e uma etapa que some faria o leitor achar que o
 *     formulário tinha menos perguntas.
 */

const versions: BriefingVersionRef[] = [
  { id: 'v2', version: 2, submittedAt: '2026-07-26T13:00:00Z' },
  { id: 'v1', version: 1, submittedAt: '2026-07-20T09:00:00Z' },
];

function detail(over: Partial<BriefingVersionDetail> = {}): BriefingVersionDetail {
  return {
    id: 'v2',
    version: 2,
    submittedAt: '2026-07-26T13:00:00Z',
    clientProjectId: 'p1',
    answers: {
      '1': {
        company: 'EPG Trindade',
        segment: 'G',
        state: 'SP',
        city: '3550308',
        services: ['Consultoria', 'Suporte'],
      },
      '4': { kind: 'ecommerce' },
      '9': { complexity: 'media', confirmed: true },
    },
    labels: {
      '1.segment': 'Comércio e varejo',
      '1.state': 'São Paulo',
      '1.city': 'São Paulo',
    },
    attachments: [],
    ...over,
  };
}

function renderPanel(list: BriefingVersionRef[] = [versions[0]]) {
  const onClose = vi.fn();
  render(
    <BriefingVersionPanel
      versions={list}
      projectTitle="Site institucional"
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe('BriefingVersionPanel', () => {
  beforeEach(() => {
    apiMock.getBriefingVersion.mockReset();
    apiMock.getBriefingVersion.mockResolvedValue(detail());
  });

  it('mostra as respostas com o rótulo, nunca o código gravado', async () => {
    renderPanel();

    expect(await screen.findByText('Comércio e varejo')).toBeInTheDocument();
    // Duas vezes: o estado e a cidade, ambos traduzidos.
    expect(screen.getAllByText('São Paulo')).toHaveLength(2);
    // Os códigos do `jsonb` não podem vazar para a tela.
    expect(screen.queryByText('G')).not.toBeInTheDocument();
    expect(screen.queryByText('SP')).not.toBeInTheDocument();
    expect(screen.queryByText('3550308')).not.toBeInTheDocument();
  });

  it('traduz também as opções fixas, que não passam pelo servidor', async () => {
    renderPanel();

    // `kind` tem opções no `steps.ts`: o rótulo sai do próprio front.
    expect(
      await screen.findByText('Loja virtual (e-commerce)'),
    ).toBeInTheDocument();
    expect(screen.queryByText('ecommerce')).not.toBeInTheDocument();
  });

  /**
   * O `complexity` desenha cartões no formulário (`kind: 'complexity'`) e por
   * isso nasceu sem `options` — a leitura caía no valor cru. O dogfooding
   * mostrou "alta" em tela; a correção foi no `steps.ts`, então serve também à
   * revisão da etapa 9.
   */
  it('traduz o nível de complexidade, que não tem select no formulário', async () => {
    renderPanel();

    expect(await screen.findByText('Média')).toBeInTheDocument();
    expect(screen.queryByText('media')).not.toBeInTheDocument();
  });

  it('lista une os itens em vez de mostrar o array cru', async () => {
    renderPanel();
    expect(await screen.findByText('Consultoria, Suporte')).toBeInTheDocument();
  });

  it('confirmação booleana vira "Sim", não "true"', async () => {
    renderPanel();
    expect(await screen.findByText('Sim')).toBeInTheDocument();
    expect(screen.queryByText('true')).not.toBeInTheDocument();
  });

  it('etapa não respondida diz "Não informado", não some da tela', async () => {
    renderPanel();

    // As etapas 2, 3, 5, 6, 7 e 8 não vieram no fixture.
    expect((await screen.findAllByText(/não informado/i)).length).toBe(6);
    // As 9 etapas continuam visíveis.
    expect(screen.getByText(/^2\. Objetivo$/)).toBeInTheDocument();
  });

  /**
   * A `BriefingVersion` é imutável (§5). Nenhum controle de edição em tela: um
   * `input` aqui prometeria uma escrita que a API não tem, e o usuário
   * descobriria só ao tentar salvar.
   */
  it('não oferece nenhum campo editável nem botão de salvar', async () => {
    renderPanel();
    await screen.findByText('Comércio e varejo');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /salvar|editar/i })).not.toBeInTheDocument();
  });

  it('com uma versão só, não mostra seletor', async () => {
    renderPanel();
    await screen.findByText('Comércio e varejo');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('com duas versões, troca para a v1 — que continua legível', async () => {
    renderPanel(versions);
    await screen.findByText('Comércio e varejo');

    apiMock.getBriefingVersion.mockResolvedValue(
      detail({ id: 'v1', version: 1, answers: { '1': { company: 'Versão antiga' } } }),
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'v1');

    expect(await screen.findByText('Versão antiga')).toBeInTheDocument();
    expect(apiMock.getBriefingVersion).toHaveBeenLastCalledWith('v1');
  });

  it('anexo baixa por link direto, com o tamanho legível', async () => {
    apiMock.getBriefingVersion.mockResolvedValue(
      detail({
        attachments: [
          { id: 'f1', name: 'logo.png', mime: 'image/png', size: 2048 },
        ],
      }),
    );
    renderPanel();

    const link = await screen.findByRole('link', { name: /baixar · 2 kb/i });
    // `<a href>`, não `fetch`: o browser precisa do Content-Disposition.
    expect(link).toHaveAttribute('href', '/api/t/t1/files/f1');
  });

  it('sem anexo, diz que não houve arquivo em vez de omitir a seção', async () => {
    renderPanel();
    expect(await screen.findByText(/nenhum arquivo enviado/i)).toBeInTheDocument();
  });

  it('falha ao carregar mostra aviso com "tentar de novo"', async () => {
    apiMock.getBriefingVersion.mockRejectedValue(new Error('API 500: db down'));
    renderPanel();

    expect(
      await screen.findByText(/não foi possível carregar o briefing/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/db down/)).toBeInTheDocument();
  });

  it('Esc fecha', async () => {
    const { onClose } = renderPanel();
    await screen.findByText('Comércio e varejo');

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
