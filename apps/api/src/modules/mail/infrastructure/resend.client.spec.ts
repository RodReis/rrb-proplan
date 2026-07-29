import { ResendClient } from './resend.client';

/**
 * Adapter do Resend (SPEC-038). `fetch` mockado — o CI nunca fala com o
 * provedor.
 *
 * O caso que mais justifica este arquivo é o **`User-Agent`**: requisições sem
 * esse header são bloqueadas antes de chegar à API, com `403` e código `1010`,
 * e a mensagem não menciona o header. `curl` manda sozinho, `fetch` não — é a
 * classe de erro que só aparece em produção e leva uma tarde para achar.
 */
describe('ResendClient', () => {
  const fetchMock = jest.fn();
  let client: ResendClient;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as never;
    process.env.RESEND_API_KEY = 're_teste';
    process.env.MAIL_FROM = 'nao-responda@mail.exemplo.com';
    client = new ResendClient();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-abc' }),
    });
  });

  const entrada = {
    to: 'comprador@exemplo.com',
    subject: 'Sua chave',
    html: '<p>chave</p>',
    text: 'chave',
  };

  it('manda `User-Agent` — sem ele o Resend devolve 403/1010', async () => {
    await client.send(entrada);

    const { headers } = fetchMock.mock.calls[0][1];
    expect(headers['User-Agent']).toBeTruthy();
  });

  it('autentica com Bearer e manda `to` como array', async () => {
    await client.send(entrada);

    const [url, opcoes] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opcoes.headers.Authorization).toBe('Bearer re_teste');
    expect(JSON.parse(opcoes.body).to).toEqual(['comprador@exemplo.com']);
  });

  it('manda `text` junto do `html`', async () => {
    // Cliente que bloqueia HTML mostraria mensagem vazia, e filtro de spam
    // pontua pior mensagem só-HTML — num e-mail que entrega o que o cliente
    // pagou, cair no spam é o pior desfecho.
    await client.send(entrada);
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.text).toBe('chave');
    expect(corpo.html).toBe('<p>chave</p>');
  });

  it('devolve o id do provedor', async () => {
    await expect(client.send(entrada)).resolves.toEqual({ providerMessageId: 'resend-abc' });
  });

  it('lança com o status e o corpo quando o provedor recusa', async () => {
    // A mensagem vai para `MailDelivery.error` e é o que o admin lê: um
    // "falhou" sem o motivo deixaria "domínio não verificado" indistinguível
    // de "chave inválida".
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"domain is not verified"}',
    });

    await expect(client.send(entrada)).rejects.toThrow(/422.*domain is not verified/);
  });

  it('lança quando vem 200 sem `id`', async () => {
    // Tratar como sucesso gravaria SENT sem `providerMessageId`, e "o que
    // aconteceu com este e-mail?" ficaria sem resposta no painel do provedor.
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await expect(client.send(entrada)).rejects.toThrow(/sem `id`/);
  });

  it.each([
    ['RESEND_API_KEY', () => delete process.env.RESEND_API_KEY],
    ['MAIL_FROM', () => delete process.env.MAIL_FROM],
  ])('falha antes da rede quando falta %s', async (nome, remover) => {
    // Com o nome da variável na mensagem: sem isto a chamada sairia com
    // `Bearer ` vazio e voltaria um 401 genérico — mesma falha, mensagem que
    // não ensina nada.
    remover();

    await expect(client.send(entrada)).rejects.toThrow(new RegExp(nome));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
