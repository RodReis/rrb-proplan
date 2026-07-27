import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingForm } from './BriefingForm';
import type { Catalog, PublicState } from './briefingApi';

/**
 * O formulário de 9 etapas (SPEC-031 §1 e §2).
 *
 * O que estes testes protegem — os critérios de aceite que dão para provar sem
 * navegador:
 *
 *   - avanço bloqueado por campo obrigatório vazio, **sem** chamar a API;
 *   - voltar preserva o que já foi respondido;
 *   - a etapa 9 mostra os três níveis **sem citar modelo de IA**, nem na tela
 *     nem no payload;
 *   - a etapa 8 declara em tela que a modalidade é preferência;
 *   - campo vazio não vira `""` no payload (ausência é informação, ADR-014);
 *   - link revogado no meio do preenchimento avisa quem está respondendo.
 */

const CATALOG: Catalog = {
  segments: [
    { value: 'comercio', label: 'Comércio' },
    { value: 'servicos', label: 'Serviços' },
  ],
  states: [{ value: 'SP', label: 'São Paulo' }],
  services: { comercio: ['Loja virtual', 'Catálogo online'] },
};

function setup(initial: Partial<PublicState> = {}) {
  const onLinkGone = vi.fn();
  render(
    <BriefingForm
      token="tok"
      initial={{ status: 'valid', step: 1, answers: {}, ...initial }}
      catalog={CATALOG}
      onLinkGone={onLinkGone}
    />,
  );
  return { onLinkGone, user: userEvent.setup() };
}

/** Rotas do rascunho: PATCH devolve progresso, cidades devolvem lista. */
function mockFetch(patch: (url: string) => Response = () => json({ step: 1 })) {
  return vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (init?.method === 'PATCH') return Promise.resolve(patch(url));
    if (url.includes('/cities/')) {
      return Promise.resolve(json([{ value: '3550308', label: 'São Paulo' }]));
    }
    return Promise.resolve(json({}));
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** O corpo do último PATCH — é onde se confere o que foi realmente enviado. */
function lastPatchBody(mock: ReturnType<typeof mockFetch>) {
  const patches = mock.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
  );
  const last = patches[patches.length - 1];
  return JSON.parse(String((last?.[1] as RequestInit).body));
}

describe('BriefingForm (SPEC-031)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  describe('navegação', () => {
    it('abre na etapa 1 com indicador de progresso', () => {
      mockFetch();
      setup();

      expect(screen.getByText('Etapa 1 de 9')).toBeInTheDocument();
      expect(screen.getByText('Contexto do negócio')).toBeInTheDocument();
    });

    it('campo obrigatório vazio bloqueia o avanço e NÃO chama a API', async () => {
      const fetchMock = mockFetch();
      const { user } = setup();

      await user.click(screen.getByRole('button', { name: 'Continuar' }));

      expect(await screen.findAllByText('obrigatório')).toHaveLength(2);
      expect(screen.getByText('Etapa 1 de 9')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('erro do campo some quando a pessoa começa a corrigir', async () => {
      mockFetch();
      const { user } = setup();

      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      expect(await screen.findAllByText('obrigatório')).toHaveLength(2);

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria');
      expect(screen.getAllByText('obrigatório')).toHaveLength(1);
    });

    it('voltar preserva o que já foi respondido', async () => {
      mockFetch();
      const { user } = setup();

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria do Zé');
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');
      await user.click(screen.getByRole('button', { name: 'Continuar' }));

      expect(await screen.findByText('Etapa 2 de 9')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Voltar' }));

      expect(await screen.findByText('Etapa 1 de 9')).toBeInTheDocument();
      expect(screen.getByLabelText(/empresa ou seu nome/i)).toHaveValue('Padaria do Zé');
    });

    it('"Voltar" fica desabilitado na primeira etapa', () => {
      mockFetch();
      setup();
      expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();
    });

    it('retoma na etapa em que o rascunho parou', () => {
      mockFetch();
      setup({ step: 7, answers: { '7': { urgency: 'urgente' } } });

      expect(screen.getByText('Etapa 7 de 9')).toBeInTheDocument();
      expect(screen.getByLabelText(/urgência/i)).toHaveValue('urgente');
    });
  });

  describe('payload', () => {
    it('campo preenchido e depois apagado não vira "" no payload', async () => {
      const fetchMock = mockFetch();
      const { user } = setup();

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria');
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');

      // Toca o opcional e desfaz: sem a poda, `state: ''` iria para o `jsonb` —
      // e "" é diferente de "não informado" para quem lê depois (ADR-014).
      await user.selectOptions(screen.getByLabelText(/^estado/i), 'SP');
      await user.selectOptions(screen.getByLabelText(/^estado/i), '');

      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await screen.findByText('Etapa 2 de 9');

      const body = lastPatchBody(fetchMock);
      expect(body.answers).toEqual({ company: 'Padaria', segment: 'comercio' });
      expect(Object.keys(body.answers)).not.toContain('state');
    });

    it('etapa opcional intocada não vira requisição', async () => {
      const fetchMock = mockFetch();
      const { user } = setup({ step: 6, answers: {} });

      await user.click(screen.getByRole('button', { name: 'Continuar' }));

      expect(await screen.findByText('Etapa 7 de 9')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('422 do servidor manda na tela, mesmo quando a checagem local passou', async () => {
      const fetchMock = mockFetch(() =>
        json(
          { message: { errors: [{ step: 1, field: 'company', message: 'campo desconhecido' }] } },
          422,
        ),
      );
      const { user } = setup();

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria');
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');
      await user.click(screen.getByRole('button', { name: 'Continuar' }));

      expect(await screen.findByText('campo desconhecido')).toBeInTheDocument();
      // Fica na etapa do erro: avançar mostraria o problema longe dele.
      expect(screen.getByText('Etapa 1 de 9')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalled();
    });

    it('link revogado no meio do preenchimento avisa a página', async () => {
      mockFetch(() => json({ status: 'revoked' }, 410));
      const { user, onLinkGone } = setup();

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria');
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');
      await user.click(screen.getByRole('button', { name: 'Continuar' }));

      await waitFor(() => expect(onLinkGone).toHaveBeenCalled());
    });

    it('rede fora não perde o que foi digitado', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
      const { user } = setup();

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria');
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');
      await user.click(screen.getByRole('button', { name: 'Continuar' }));

      expect(await screen.findByText(/sem conexão/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/empresa ou seu nome/i)).toHaveValue('Padaria');
    });
  });

  describe('etapa 1 — catálogo e localidades', () => {
    it('serviços do catálogo aparecem conforme o segmento escolhido', async () => {
      mockFetch();
      const { user } = setup();

      expect(screen.queryByRole('button', { name: 'Loja virtual' })).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');

      expect(screen.getByRole('button', { name: 'Loja virtual' })).toBeInTheDocument();
    });

    it('escolher o estado busca as cidades na NOSSA API, nunca no IBGE', async () => {
      const fetchMock = mockFetch();
      const { user } = setup();

      await user.selectOptions(screen.getByLabelText(/^estado/i), 'SP');

      await waitFor(() =>
        expect(screen.getByLabelText(/cidade/i)).not.toBeDisabled(),
      );
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/b/tok/cities/SP'))).toBe(true);
      expect(urls.some((u) => u.includes('ibge'))).toBe(false);
    });

    it('item livre entra na resposta sem virar linha no catálogo do tenant', async () => {
      const fetchMock = mockFetch();
      const { user } = setup();

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria');
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');
      await user.type(
        screen.getByPlaceholderText(/acrescentar outro/i),
        'Bolo de pote{Enter}',
      );
      await user.click(screen.getByRole('button', { name: 'Continuar' }));

      await screen.findByText('Etapa 2 de 9');
      expect(lastPatchBody(fetchMock).answers.services).toEqual(['Bolo de pote']);
      // Nenhuma rota de escrita do catálogo é chamada — a curadoria é do prestador.
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('service-catalog'))).toBe(false);
    });
  });

  describe('etapas 8 e 9', () => {
    it('a etapa 8 declara em tela que a modalidade é só preferência', () => {
      mockFetch();
      setup({ step: 8 });

      expect(screen.getByText(/preferência, não um compromisso/i)).toBeInTheDocument();
      expect(screen.getByText(/definida na proposta/i)).toBeInTheDocument();
    });

    it('a etapa 9 mostra os três níveis sem citar nenhum modelo de IA', () => {
      mockFetch();
      setup({ step: 9 });

      for (const nivel of ['Baixa', 'Média', 'Alta']) {
        expect(screen.getByRole('radio', { name: new RegExp(nivel) })).toBeInTheDocument();
      }
      // O critério de aceite: nenhum nome de modelo na tela.
      const texto = document.body.textContent ?? '';
      for (const proibido of ['Claude', 'GPT', 'Opus', 'Sonnet', 'Haiku', 'modelo']) {
        expect(texto).not.toContain(proibido);
      }
    });

    it('o nível escolhido vai como baixa/media/alta no payload, sem nome de modelo', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = mockFetch();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <BriefingForm
          token="tok"
          initial={{ status: 'valid', step: 9, answers: {} }}
          catalog={CATALOG}
          onLinkGone={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('radio', { name: /Alta/ }));
      await user.click(screen.getByLabelText(/confirmo que revisei/i));

      // O botão da etapa 9 ainda não envia (o submit é o PR-5); quem grava é o
      // autosave. O que ele grava é o que o critério de aceite manda conferir.
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      const body = lastPatchBody(fetchMock);
      expect(body.answers).toEqual({ complexity: 'alta', confirmed: true });
      vi.useRealTimers();
    });

    it('a revisão da etapa 9 lista as respostas com atalho para corrigir', async () => {
      mockFetch();
      const { user } = setup({
        step: 9,
        answers: { '1': { company: 'Padaria do Zé', segment: 'comercio' } },
      });

      expect(screen.getByText('Suas respostas')).toBeInTheDocument();
      expect(screen.getByText(/Padaria do Zé/)).toBeInTheDocument();

      const editar = screen.getAllByRole('button', { name: 'Editar' })[0];
      await user.click(editar);
      expect(await screen.findByText('Etapa 1 de 9')).toBeInTheDocument();
    });

    it('a revisão mostra o RÓTULO do segmento e do estado, não o código', () => {
      mockFetch();
      setup({ step: 9, answers: { '1': { segment: 'comercio', state: 'SP' } } });

      // Quem escolheu "Comércio" não reconhece "comercio"/"SP" — revisar o que
      // não se entende não é revisar.
      expect(screen.getByText(/Comércio/)).toBeInTheDocument();
      expect(screen.getByText(/São Paulo/)).toBeInTheDocument();
    });

    it('etapa não respondida aparece como "Não informado" na revisão', () => {
      mockFetch();
      setup({ step: 9, answers: {} });

      expect(screen.getAllByText('Não informado').length).toBeGreaterThan(0);
    });
  });

  describe('autosave', () => {
    it('salva sozinho depois de 30 s de inatividade, sem ninguém clicar', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = mockFetch();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <BriefingForm
          token="tok"
          initial={{ status: 'valid', step: 2, answers: {} }}
          catalog={CATALOG}
          onLinkGone={vi.fn()}
        />,
      );

      await user.type(screen.getByLabelText(/problema a resolver/i), 'Sem site');
      expect(fetchMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(lastPatchBody(fetchMock)).toMatchObject({
        step: 2,
        answers: { problem: 'Sem site' },
      });
      vi.useRealTimers();
    });

    it('não reenvia etapa que não mudou — o teto de escrita é 10/min', async () => {
      const fetchMock = mockFetch();
      const { user } = setup();

      await user.type(screen.getByLabelText(/empresa ou seu nome/i), 'Padaria');
      await user.selectOptions(screen.getByLabelText(/^segmento/i), 'comercio');
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await screen.findByText('Etapa 2 de 9');

      await user.click(screen.getByRole('button', { name: 'Voltar' }));
      await screen.findByText('Etapa 1 de 9');
      await user.click(screen.getByRole('button', { name: 'Continuar' }));
      await screen.findByText('Etapa 2 de 9');

      const patches = fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patches).toHaveLength(1);
    });
  });
});
