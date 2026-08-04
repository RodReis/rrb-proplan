import { Job } from 'bullmq';
import type { MailJobData } from '../application/mail.service';
import { MailWorker } from './mail.worker';
import { MailProvider } from './resend.client';

/**
 * `MailWorker` (SPEC-038) — quem fala com o provedor.
 *
 * Os quatro modos de errar que estes testes fecham:
 *
 * 1. **Falha marcada como sucesso.** O Resend não lança exceção: devolve
 *    `{ data, error }`. Nosso adapter converte para `throw`; se ele parasse de
 *    fazer isso, `SENT` seria gravado num e-mail que não saiu.
 * 2. **Reentrega da chave.** O BullMQ pode reprocessar um job cujo worker
 *    morreu depois do envio — e dois e-mails com chaves diferentes deixam o
 *    comprador sem saber qual vale.
 * 3. **Contador parado.** Sem `attempts` a cada passagem, "falhou uma vez" e
 *    "falhou cinco" ficam indistinguíveis no admin.
 * 4. **Escrita sem contexto de tenant.** Fora de request o RLS é fail-closed:
 *    um update sem contexto atualiza ZERO LINHAS sem erro.
 */
describe('MailWorker', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const send = jest.fn();
  const runInTenantContext = jest.fn();

  const prisma = {
    mailDelivery: { findUnique, update },
    runInTenantContext,
  } as never;
  const provider = { send } as unknown as MailProvider;

  let worker: MailWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    // Executa o callback de verdade, guardando os tenants recebidos: é assim
    // que o teste vê o contexto sem mockar o Postgres.
    runInTenantContext.mockImplementation((_tenants: string[], fn: () => unknown) => fn());
    findUnique.mockResolvedValue({
      id: 'entrega-1',
      to: 'comprador@exemplo.com',
      status: 'PENDING',
    });
    send.mockResolvedValue({ providerMessageId: 'resend-abc' });
    worker = new MailWorker(prisma, provider);
  });

  const job = (extra: Partial<Job<MailJobData>> = {}) =>
    ({
      attemptsMade: 0,
      data: {
        deliveryId: 'entrega-1',
        tenantId: 't1',
        template: 'license_key',
        data: {
          customerName: 'Maria',
          licenseKey: 'WR-AB12-CD34-EF56-GH78',
          productName: 'War Room',
          editionName: 'Com código-fonte',
        },
      },
      ...extra,
    }) as Job<MailJobData>;

  it('renderiza o corpo a partir do job, não do banco', async () => {
    // O ponto do desenho: a chave nunca esteve no banco, e ainda assim o e-mail
    // sai completo.
    await worker.process(job());

    const enviado = send.mock.calls[0][0];
    expect(enviado.html).toContain('WR-AB12-CD34-EF56-GH78');
    expect(enviado.text).toContain('WR-AB12-CD34-EF56-GH78');
    expect(enviado.to).toBe('comprador@exemplo.com');
  });

  it('grava SENT com o id do provedor e a data', async () => {
    await worker.process(job());

    const gravado = update.mock.calls[0][0].data;
    expect(gravado.status).toBe('SENT');
    expect(gravado.providerMessageId).toBe('resend-abc');
    expect(gravado.sentAt).toBeInstanceOf(Date);
    expect(gravado.attempts).toBe(1);
  });

  it('limpa o erro da tentativa anterior ao enviar', async () => {
    // Entrega SENT que ainda mostra a mensagem da falha de ontem faz o admin
    // abrir chamado para um problema que já se resolveu sozinho.
    await worker.process(job({ attemptsMade: 2 } as Partial<Job<MailJobData>>));
    expect(update.mock.calls[0][0].data.error).toBeNull();
  });

  it('roda tudo sob o contexto do tenant do job', async () => {
    // Sem isto o update grava ZERO LINHAS sem erro, e o envio "bem-sucedido"
    // não aparece em lugar nenhum.
    await worker.process(job());
    expect(runInTenantContext).toHaveBeenCalledWith(['t1'], expect.any(Function));
  });

  describe('quando o provedor falha', () => {
    beforeEach(() => send.mockRejectedValue(new Error('Resend respondeu 500: indisponível')));

    it('marca FAILED com o motivo e RELANÇA para o BullMQ retentar', async () => {
      // Engolir aqui marcaria falha definitiva na primeira instabilidade de
      // rede — que é justamente o que o retry existe para atravessar.
      await expect(worker.process(job())).rejects.toThrow(/500/);

      const gravado = update.mock.calls[0][0].data;
      expect(gravado.status).toBe('FAILED');
      expect(gravado.error).toContain('Resend respondeu 500');
      expect(gravado.attempts).toBe(1);
    });

    it('conta a tentativa que está correndo, não a anterior', async () => {
      // `attemptsMade` é 0 na primeira passagem. Gravar esse valor cru diria
      // "0 tentativas" para uma entrega que já falhou uma vez.
      await expect(
        worker.process(job({ attemptsMade: 3 } as Partial<Job<MailJobData>>)),
      ).rejects.toThrow();
      expect(update.mock.calls[0][0].data.attempts).toBe(4);
    });

    it('trunca mensagem gigante do provedor', async () => {
      send.mockRejectedValue(new Error('x'.repeat(2000)));
      await expect(worker.process(job())).rejects.toThrow();
      expect(update.mock.calls[0][0].data.error.length).toBe(500);
    });

    it('loga a falha com o motivo do provedor', async () => {
      // O defeito real que este teste tranca: o worker atravessava as duas
      // saídas mudo. O sucesso quem loga é o provedor; a falha não logava
      // ninguém — e quem investigava "o e-mail não chegou" pelo log de produção
      // via o job ser enfileirado e nada depois, concluindo que o worker nem
      // rodou. Sem o destinatário: dado pessoal fica na `MailDelivery`.
      const aviso = jest.spyOn(worker['logger'], 'warn').mockImplementation();

      await expect(worker.process(job())).rejects.toThrow();

      expect(aviso).toHaveBeenCalledWith(expect.stringContaining('Resend respondeu 500'));
      expect(aviso.mock.calls[0][0]).not.toContain('comprador@exemplo.com');
    });
  });

  it('não reenvia uma entrega já SENT', async () => {
    // O BullMQ pode reprocessar um job cujo worker morreu DEPOIS do envio. Um
    // segundo e-mail com a chave é pior que nenhum: o comprador não sabe qual
    // vale — e as duas chaves são diferentes, porque cada emissão gera a sua.
    findUnique.mockResolvedValue({ id: 'entrega-1', to: 'x@y.com', status: 'SENT' });

    await worker.process(job());

    expect(send).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('descarta job de entrega inexistente sem relançar', async () => {
    // Sem linha não há o que atualizar nem como auditar; relançar faria o retry
    // procurar a mesma linha inexistente mais quatro vezes.
    findUnique.mockResolvedValue(null);

    await expect(worker.process(job())).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
