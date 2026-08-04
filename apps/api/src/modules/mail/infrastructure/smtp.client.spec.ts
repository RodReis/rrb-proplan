import { SmtpClient } from './smtp.client';

/** A config que o `createTransport` recebe — só o que os testes conferem. */
interface TransportConfig {
  host: string;
  port: number;
  secure: boolean;
}

const sendMailMock = jest.fn();
const createTransportMock = jest.fn((_config: TransportConfig) => ({
  sendMail: sendMailMock,
}));

jest.mock('nodemailer', () => ({
  createTransport: (config: TransportConfig) => createTransportMock(config),
}));

/**
 * Adapter SMTP. `nodemailer` mockado — o CI nunca abre conexão.
 *
 * O caso que mais justifica este arquivo é o **`secure` derivado da porta**:
 * 465 é TLS implícito e 587 é STARTTLS, e trocar os dois trava o handshake com
 * um timeout que não diz o que houve. É a classe de erro que só aparece em
 * produção — a mesma família do `User-Agent` no `ResendClient`.
 */
describe('SmtpClient', () => {
  let client: SmtpClient;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMTP_HOST = 'smtp.hostinger.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'warroom@exemplo.com.br';
    process.env.SMTP_PASS = 'segredo';
    process.env.SMTP_FROM = 'warroom@exemplo.com.br';
    delete process.env.SMTP_SECURE;
    delete process.env.MAIL_FROM;
    sendMailMock.mockResolvedValue({ messageId: '<abc@exemplo>' });
    client = new SmtpClient();
  });

  const entrada = {
    to: 'comprador@exemplo.com',
    subject: 'Sua chave',
    html: '<p>chave</p>',
    text: 'chave',
  };

  it('usa TLS implícito na 465', async () => {
    await client.send(entrada);

    const config = createTransportMock.mock.calls[0][0];
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true);
  });

  it('usa STARTTLS na 587 — sem `secure`, o handshake trava', async () => {
    process.env.SMTP_PORT = '587';
    client = new SmtpClient();

    await client.send(entrada);

    const config = createTransportMock.mock.calls[0][0];
    expect(config.port).toBe(587);
    expect(config.secure).toBe(false);
  });

  it('deixa `SMTP_SECURE` explícito vencer a porta', async () => {
    // O provedor que usa 465 com STARTTLS existe; sem esta saída, a única forma
    // de atendê-lo seria mudar código.
    process.env.SMTP_SECURE = 'false';
    client = new SmtpClient();

    await client.send(entrada);

    expect(createTransportMock.mock.calls[0][0].secure).toBe(false);
  });

  it('manda `text` junto do `html`', async () => {
    // Cliente que bloqueia HTML mostraria mensagem vazia, e filtro de spam
    // pontua pior mensagem só-HTML — num e-mail que entrega o que o cliente
    // pagou, cair no spam é o pior desfecho.
    await client.send(entrada);

    const enviado = sendMailMock.mock.calls[0][0];
    expect(enviado.text).toBe('chave');
    expect(enviado.html).toBe('<p>chave</p>');
  });

  it('devolve o `messageId` do servidor', async () => {
    const { providerMessageId } = await client.send(entrada);
    expect(providerMessageId).toBe('<abc@exemplo>');
  });

  it('reaproveita o transporter entre envios', async () => {
    // Um transporter por envio abriria e derrubaria uma conexão TLS a cada
    // e-mail, e o handshake é a parte cara.
    await client.send(entrada);
    await client.send(entrada);

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('aceita `MAIL_FROM` quando `SMTP_FROM` não existe', async () => {
    // A variável antiga já existia para o Resend: exigir a nova quebraria o
    // envio por uma renomeação.
    delete process.env.SMTP_FROM;
    process.env.MAIL_FROM = 'antigo@exemplo.com.br';
    client = new SmtpClient();

    await client.send(entrada);

    expect(sendMailMock.mock.calls[0][0].from).toBe('antigo@exemplo.com.br');
  });

  it.each([
    ['SMTP_HOST', () => delete process.env.SMTP_HOST],
    ['SMTP_USER', () => delete process.env.SMTP_USER],
    ['SMTP_PASS', () => delete process.env.SMTP_PASS],
  ])('falha antes da rede quando falta %s', async (nome, remover) => {
    // Com o nome da variável na mensagem: sem isto o erro seria um timeout ou um
    // "authentication failed" genérico — mesma falha, mensagem que não ensina
    // nada. É o que o admin lê em `MailDelivery.error`.
    remover();
    client = new SmtpClient();

    await expect(client.send(entrada)).rejects.toThrow(nome);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('falha quando o remetente não está configurado', async () => {
    delete process.env.SMTP_FROM;
    delete process.env.MAIL_FROM;
    client = new SmtpClient();

    await expect(client.send(entrada)).rejects.toThrow('SMTP_FROM');
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('recusa envio aceito sem `messageId`', async () => {
    // `SENT` sem id deixaria "o que aconteceu com este e-mail?" sem resposta.
    sendMailMock.mockResolvedValue({});

    await expect(client.send(entrada)).rejects.toThrow('não rastreável');
  });

  it('propaga a falha do servidor — é o `throw` que faz o BullMQ retentar', async () => {
    sendMailMock.mockRejectedValue(new Error('535 authentication failed'));

    await expect(client.send(entrada)).rejects.toThrow('535 authentication failed');
  });
});
