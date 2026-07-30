import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceLinkPage } from './SourceLinkPage';

/**
 * A página pública de coleta de username (SPEC-039). O que se prova aqui é o que
 * o **comprador** vê — alguém sem conta no ProPlan, que recebeu o link por
 * e-mail, e que pagou pela edição mais cara do catálogo.
 *
 * As três coisas que esta tela não pode errar:
 *
 * 1. **Confirmação com avatar antes de gravar.** Sem ela, um typo convida um
 *    estranho para um repositório privado — e o erro só apareceria quando o
 *    estranho aceitasse.
 * 2. **`used` não é `invalid`.** Reabrir o próprio link mostra "já utilizado";
 *    mostrar o formulário de novo faria o comprador achar que o envio falhou.
 * 3. **GitHub fora do ar não é "usuário não existe".** Dizer que é manda o
 *    comprador corrigir um dado correto, ou desistir.
 */
function renderAt(token = 'tok-abc') {
  render(
    <MemoryRouter initialEntries={[`/s/${token}`]}>
      <Routes>
        <Route path="/s/:token" element={<SourceLinkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const VALIDO = { status: 'valid', product: 'War Room', edition: 'Com código-fonte' };
const USUARIO = { login: 'RodReis', name: 'Rodrigo Reis', avatarUrl: 'https://a/1' };

/**
 * Roteia por URL, não por ordem de chamada: a página pode reorganizar as
 * requisições sem que o teste minta sobre o que ela pediu.
 */
function rotear(mapa: {
  estado?: { body: unknown; status?: number };
  lookup?: { body: unknown; status?: number };
  username?: { body: unknown; status?: number };
}) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const escolhido = url.endsWith('/lookup')
      ? mapa.lookup
      : url.endsWith('/username')
        ? mapa.username
        : mapa.estado;
    const r = escolhido ?? { body: {}, status: 500 };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe('abrir o link', () => {
  it('link válido mostra o formulário nomeando o produto', async () => {
    rotear({ estado: { body: VALIDO } });
    renderAt();

    expect(await screen.findByLabelText(/usuário do github/i)).toBeInTheDocument();
    // Nomear o produto é o que faz o comprador reconhecer a própria compra —
    // "informe seu usuário" sozinho parece phishing.
    expect(screen.getByText(/War Room/)).toBeInTheDocument();
  });

  it('declara a finalidade do dado (LGPD)', async () => {
    rotear({ estado: { body: VALIDO } });
    renderAt();

    await screen.findByLabelText(/usuário do github/i);
    expect(
      screen.getByText(/apenas para convidá-lo ao repositório/i),
    ).toBeInTheDocument();
  });

  it('link já usado diz "já utilizado" e NÃO mostra o formulário', async () => {
    rotear({ estado: { body: { status: 'used' } } });
    renderAt();

    expect(await screen.findByText(/já utilizado/i)).toBeInTheDocument();
    // O critério de aceite: nunca o formulário de novo. Quem informou o username
    // e recarregou precisa saber que deu certo.
    expect(screen.queryByLabelText(/usuário do github/i)).not.toBeInTheDocument();
  });

  it('link inválido não diz por quê', async () => {
    rotear({ estado: { body: { status: 'invalid' } } });
    renderAt();

    const msg = await screen.findByText(/link inválido/i);
    // Resposta não-diferencial: vazar na tela o que a API esconde anularia a
    // proteção do servidor.
    expect(msg).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/tenant|revogad|outro cliente/i);
  });

  it('429 e 5xx não acusam o link', async () => {
    rotear({ estado: { body: {}, status: 503 } });
    renderAt();

    // Aqui isso é pior que no briefing: o link é de uso único, e não há outro sem
    // passar pelo admin. Dizer "inválido" mandaria o comprador desistir dele.
    expect(await screen.findByText(/não foi possível verificar agora/i)).toBeInTheDocument();
    expect(screen.getByText(/continua válido/i)).toBeInTheDocument();
    expect(screen.queryByText(/link inválido/i)).not.toBeInTheDocument();
  });

  it('põe `noindex` na página — a URL carrega o token', async () => {
    rotear({ estado: { body: VALIDO } });
    renderAt();

    await screen.findByLabelText(/usuário do github/i);
    // A URL indexada entregaria acesso a código-fonte privado a quem buscar.
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute('content')).toMatch(/noindex/);
  });
});

describe('confirmar quem será convidado', () => {
  it('mostra avatar, nome e login antes de gravar', async () => {
    rotear({ estado: { body: VALIDO }, lookup: { body: USUARIO } });
    renderAt();

    await userEvent.type(
      await screen.findByLabelText(/usuário do github/i),
      'rodreis',
    );
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    expect(await screen.findByText('@RodReis')).toBeInTheDocument();
    expect(screen.getByText('Rodrigo Reis')).toBeInTheDocument();
    // O avatar é o que faz a confirmação funcionar: um typo passa despercebido
    // num login parecido, não numa foto de outra pessoa.
    expect(document.querySelector('img[src="https://a/1"]')).toBeTruthy();
  });

  it('consultar NÃO grava', async () => {
    const fetchMock = rotear({ estado: { body: VALIDO }, lookup: { body: USUARIO } });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'rodreis');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await screen.findByText('@RodReis');

    // Se `/username` fosse chamada aqui, a confirmação seria decorativa — o
    // convite já estaria decidido antes de a pessoa olhar a foto.
    const chamadas = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(chamadas.some((u) => u.endsWith('/username'))).toBe(false);
  });

  it('confirmar grava e mostra o login registrado', async () => {
    const fetchMock = rotear({
      estado: { body: VALIDO },
      lookup: { body: USUARIO },
      username: { body: { username: 'RodReis' } },
    });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'rodreis');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.click(await screen.findByRole('button', { name: /sim, sou eu/i }));

    expect(await screen.findByText(/tudo certo/i)).toBeInTheDocument();
    // O login canônico do GitHub, não o digitado: é o que foi gravado.
    expect(screen.getByText('@RodReis')).toBeInTheDocument();
    const chamadas = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(chamadas.some((u) => u.endsWith('/username'))).toBe(true);
  });

  it('manda `confirm: true` no corpo', async () => {
    const fetchMock = rotear({
      estado: { body: VALIDO },
      lookup: { body: USUARIO },
      username: { body: { username: 'RodReis' } },
    });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'rodreis');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.click(await screen.findByRole('button', { name: /sim, sou eu/i }));
    await screen.findByText(/tudo certo/i);

    const chamada = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/username'));
    const corpo = JSON.parse(String((chamada?.[1] as RequestInit).body));
    // O servidor exige o `confirm`; a tela precisa mandá-lo, senão o fluxo
    // travaria em 422 depois de a pessoa já ter confirmado na cara dela.
    expect(corpo).toEqual({ username: 'RodReis', confirm: true });
  });

  it('"corrigir o usuário" volta ao formulário sem gravar', async () => {
    const fetchMock = rotear({ estado: { body: VALIDO }, lookup: { body: USUARIO } });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'errado');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.click(await screen.findByRole('button', { name: /corrigir/i }));

    // É o caminho de saída de quem olhou a foto e viu outra pessoa. Sem ele, a
    // única opção seria confirmar ou abandonar a página.
    expect(await screen.findByLabelText(/usuário do github/i)).toBeInTheDocument();
    const chamadas = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(chamadas.some((u) => u.endsWith('/username'))).toBe(false);
  });

  it('diz que o convite ainda precisa ser aceito', async () => {
    rotear({
      estado: { body: VALIDO },
      lookup: { body: USUARIO },
      username: { body: { username: 'RodReis' } },
    });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'rodreis');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.click(await screen.findByRole('button', { name: /sim, sou eu/i }));

    // Sem esta frase o comprador esperaria acesso automático e abriria suporte
    // quando o repositório não aparecesse na conta dele.
    expect(await screen.findByText(/aceitá-lo/i)).toBeInTheDocument();
  });
});

describe('erros na consulta do username', () => {
  it('login inexistente nomeia o que foi procurado', async () => {
    rotear({
      estado: { body: VALIDO },
      lookup: { body: { username: 'zzz-nao-existe' }, status: 422 },
    });
    renderAt();

    await userEvent.type(
      await screen.findByLabelText(/usuário do github/i),
      'zzz-nao-existe',
    );
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    // Sem o login na mensagem, o comprador não sabe se errou a digitação ou se o
    // envio não funcionou.
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('zzz-nao-existe');
    // E continua no formulário, com o campo, para corrigir.
    expect(screen.getByLabelText(/usuário do github/i)).toBeInTheDocument();
  });

  it('GitHub indisponível NÃO diz que o usuário não existe', async () => {
    rotear({ estado: { body: VALIDO }, lookup: { body: {}, status: 503 } });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'RodReis');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    const alerta = await screen.findByRole('alert');
    // A distinção que o FIX #136 firmou: `5xx` não é veredito sobre o dado. A
    // mensagem chega a dizer que o usuário provavelmente está certo.
    expect(alerta.textContent).toMatch(/não foi possível falar com o GitHub/i);
    expect(alerta.textContent).not.toMatch(/não encontramos/i);
  });

  it('link queimado no meio do fluxo cai na tela de "já utilizado"', async () => {
    rotear({
      estado: { body: VALIDO },
      lookup: { body: USUARIO },
      username: { body: {}, status: 410 },
    });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'rodreis');
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.click(await screen.findByRole('button', { name: /sim, sou eu/i }));

    // Corrida real: outra aba (ou o admin) queimou o link entre a consulta e a
    // confirmação. Mostrar "erro" genérico deixaria o comprador sem saber se o
    // username foi registrado.
    expect(await screen.findByText(/já utilizado/i)).toBeInTheDocument();
  });

  it('botão desabilitado enquanto consulta — não manda duas vezes', async () => {
    rotear({ estado: { body: VALIDO }, lookup: { body: USUARIO } });
    renderAt();

    await userEvent.type(await screen.findByLabelText(/usuário do github/i), 'rodreis');
    const botao = screen.getByRole('button', { name: /continuar/i });
    await userEvent.click(botao);

    await waitFor(() => expect(screen.getByText('@RodReis')).toBeInTheDocument());
  });

  it('não consulta com o campo vazio', async () => {
    const fetchMock = rotear({ estado: { body: VALIDO } });
    renderAt();

    await screen.findByLabelText(/usuário do github/i);
    // Desabilitado com o campo vazio: uma consulta vazia gastaria uma chamada à
    // API do GitHub para receber 404 garantido.
    expect(screen.getByRole('button', { name: /continuar/i })).toBeDisabled();
    const chamadas = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(chamadas.some((u) => u.endsWith('/lookup'))).toBe(false);
  });
});
