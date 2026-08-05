import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MailOpsService } from './mail-ops.service';

/**
 * `MailOpsService` (FIX #254): as entregas de e-mail na aba Pendências.
 *
 * O que estes testes protegem é a decisão central do FIX: **o `license_key` não
 * se reenvia**. A chave em claro não existe em lugar nenhum (SPEC-036), então
 * reenfileirar mandaria ao comprador uma mensagem dizendo *"esta é a sua
 * chave"* com o campo vazio — pior que não reenviar, porque parece que
 * funcionou.
 *
 * O resto é a mesma regra dos outros dois lugares desta área: a lista não pode
 * afirmar coisa que não sabe, e o botão que sempre falharia não é oferecido.
 */
describe('MailOpsService', () => {
  const list = jest.fn();
  const find = jest.fn();
  const retry = jest.fn();
  const findUnique = jest.fn();

  const mail = { list, find, retry } as never;
  const prisma = { license: { findUnique } } as never;

  let service: MailOpsService;

  const licenca = {
    customerName: 'Maria',
    revokedReason: 'reembolso solicitado',
    githubUsername: 'maria-dev',
    sourceInviteAt: new Date('2026-08-10T12:00:00.000Z'),
    edition: { name: 'Com código-fonte', product: { name: 'War Room' } },
  };

  /** Uma entrega como o `MailService` a devolve. */
  const entrega = (over: Record<string, unknown> = {}) => ({
    id: 'entrega-1',
    to: 'comprador@exemplo.com',
    template: 'license_revoked',
    subject: 'Sua licença foi encerrada',
    status: 'FAILED',
    attempts: 5,
    error: 'connect ECONNREFUSED',
    providerMessageId: null,
    licenseId: 'lic-1',
    createdAt: '2026-08-04T10:00:00.000Z',
    sentAt: null,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(licenca);
    service = new MailOpsService(prisma, mail);
  });

  describe('list', () => {
    it('marca o license_key como não reenviável, com o motivo e o caminho', async () => {
      // É a linha mais importante da tela: a chave que não chegou. Dizer só
      // "não dá" deixaria o operador sem saída; o motivo aponta o Reemitir.
      list.mockResolvedValue([entrega({ template: 'license_key' })]);

      const [linha] = await service.list('t1');

      expect(linha.canRetry).toBe(false);
      expect(linha.retryBlockedReason).toContain('Reemitir');
    });

    it('deixa os demais templates reenviáveis, sem motivo de bloqueio', async () => {
      list.mockResolvedValue([entrega()]);

      const [linha] = await service.list('t1');

      expect(linha.canRetry).toBe(true);
      expect(linha.retryBlockedReason).toBeNull();
    });

    it('repassa o filtro de status para o MailService', async () => {
      list.mockResolvedValue([]);

      await service.list('t1', 'FAILED');

      expect(list).toHaveBeenCalledWith('t1', 'FAILED');
    });
  });

  describe('retry', () => {
    it('recusa o license_key mesmo por chamada direta', async () => {
      // A tela já esconde o botão. Esta guarda é o que impede que um `curl`
      // produza um e-mail com o campo da chave vazio.
      find.mockResolvedValue(entrega({ template: 'license_key' }));

      await expect(service.retry('t1', 'entrega-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(retry).not.toHaveBeenCalled();
    });

    it('busca por id em vez de varrer a lista', async () => {
      // `MailService.list` trunca em 200: procurar ali acharia só as recentes,
      // e uma falha antiga responderia "não encontrada" — o beco que este FIX
      // veio fechar.
      find.mockResolvedValue(entrega());

      await service.retry('t1', 'entrega-1');

      expect(find).toHaveBeenCalledWith('t1', 'entrega-1');
      expect(list).not.toHaveBeenCalled();
    });

    it('remonta o motivo do license_revoked a partir da licença', async () => {
      find.mockResolvedValue(entrega());

      await service.retry('t1', 'entrega-1');

      expect(retry).toHaveBeenCalledWith('t1', 'entrega-1', {
        customerName: 'Maria',
        productName: 'War Room',
        editionName: 'Com código-fonte',
        reason: 'reembolso solicitado',
      });
    });

    it('usa frase neutra quando a revogação não registrou motivo', async () => {
      // Campo vazio no meio da mensagem é pior que a frase genérica: o
      // comprador leria uma lacuna onde deveria estar a explicação.
      findUnique.mockResolvedValue({ ...licenca, revokedReason: null });
      find.mockResolvedValue(entrega());

      await service.retry('t1', 'entrega-1');

      expect(retry.mock.calls[0][2].reason).toBe('A licença foi encerrada.');
    });

    it('remonta o source_username_confirmed com username e data do convite', async () => {
      find.mockResolvedValue(entrega({ template: 'source_username_confirmed' }));

      await service.retry('t1', 'entrega-1');

      expect(retry.mock.calls[0][2]).toEqual({
        customerName: 'Maria',
        productName: 'War Room',
        editionName: 'Com código-fonte',
        githubUsername: 'maria-dev',
        inviteAt: '2026-08-10T12:00:00.000Z',
      });
    });

    it('recusa o source_username_request — o link é de uso único', async () => {
      // Mesmo motivo da chave: só o hash do token é persistido. Reemitir o
      // link é o ato próprio, no admin do source.
      find.mockResolvedValue(entrega({ template: 'source_username_request' }));

      await expect(service.retry('t1', 'entrega-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(retry).not.toHaveBeenCalled();
    });

    it('recusa entrega sem licença vinculada', async () => {
      // O `mail` é compartilhado e o MVP3 vai mandar e-mail sem licença por
      // trás. Um `data: {}` genérico renderizaria template quebrado.
      find.mockResolvedValue(entrega({ licenseId: null }));

      await expect(service.retry('t1', 'entrega-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(retry).not.toHaveBeenCalled();
    });

    it('trata entrega de outro tenant como inexistente', async () => {
      // Sob RLS ela já não vem; distinguir "não existe" de "é de outro"
      // permitiria enumerar entregas alheias.
      find.mockResolvedValue(null);

      await expect(service.retry('t1', 'alheia')).rejects.toThrow(NotFoundException);
      expect(retry).not.toHaveBeenCalled();
    });
  });
});
