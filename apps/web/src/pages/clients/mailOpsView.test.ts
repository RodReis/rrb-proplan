import { describe, expect, it } from 'vitest';
import type { MailDeliveryOpsView } from '../../lib/api';
import {
  attemptsLabel,
  failedCount,
  mailErrorText,
  mailStatusLabel,
  mailStatusTone,
  templateLabel,
} from './mailOpsView';

function entrega(over: Partial<MailDeliveryOpsView> = {}): MailDeliveryOpsView {
  return {
    id: 'e1',
    to: 'comprador@exemplo.com',
    template: 'license_key',
    subject: 'Sua chave',
    status: 'FAILED',
    attempts: 5,
    error: 'timeout',
    providerMessageId: null,
    licenseId: 'lic-1',
    createdAt: '2026-08-04T12:00:00.000Z',
    sentAt: null,
    canRetry: false,
    retryBlockedReason: 'motivo',
    ...over,
  };
}

describe('mailOpsView', () => {
  describe('mailStatusTone', () => {
    it('só a falha é alerta — aguardando é o caminho normal', () => {
      // Pintar `PENDING` de vermelho faria o dono caçar problema onde não há:
      // o job ainda vai pegar a entrega.
      expect(mailStatusTone('FAILED')).toBe('alert');
      expect(mailStatusTone('PENDING')).toBe('muted');
      expect(mailStatusTone('SENT')).toBe('ok');
    });
  });

  describe('templateLabel', () => {
    it('traduz os quatro templates para linguagem de quem opera', () => {
      expect(templateLabel('license_key')).toBe('Chave da licença');
      expect(templateLabel('license_revoked')).toBe('Licença encerrada');
      expect(templateLabel('source_username_request')).toBe('Pedido do usuário do GitHub');
      expect(templateLabel('source_username_confirmed')).toBe(
        'Confirmação do usuário do GitHub',
      );
    });

    it('devolve o nome cru do template desconhecido', () => {
      // Um rótulo genérico esconderia que apareceu algo que esta tela não
      // conhece — e o nome cru é o que permite achá-lo no código.
      expect(templateLabel('template_novo')).toBe('template_novo');
    });
  });

  describe('mailErrorText', () => {
    it('diz que faltou mensagem em vez de inventar "erro desconhecido"', () => {
      // "Falhou sem mensagem registrada" é uma informação real (e um defeito
      // nosso); "erro desconhecido" soaria como estado normal.
      expect(mailErrorText(entrega({ error: null }))).toBe(
        'Falhou sem mensagem registrada',
      );
    });

    it('não mostra erro em entrega que não falhou', () => {
      expect(mailErrorText(entrega({ status: 'SENT', error: 'antigo' }))).toBeNull();
    });
  });

  describe('failedCount', () => {
    it('conta só FAILED — aguardando não acende o badge', () => {
      expect(
        failedCount([
          entrega(),
          entrega({ id: 'e2', status: 'PENDING' }),
          entrega({ id: 'e3', status: 'SENT' }),
        ]),
      ).toBe(1);
    });
  });

  describe('attemptsLabel', () => {
    it('omite o rótulo quando nada foi tentado ainda', () => {
      // "0 tentativas" seria lido como falha; a entrega só não foi processada.
      expect(attemptsLabel(0)).toBeNull();
    });

    it('concorda em número', () => {
      expect(attemptsLabel(1)).toBe('1 tentativa');
      expect(attemptsLabel(5)).toBe('5 tentativas');
    });
  });

  describe('mailStatusLabel', () => {
    it('devolve o status cru quando não o conhece', () => {
      expect(mailStatusLabel('SENT')).toBe('Enviada');
      expect(mailStatusLabel('OUTRO')).toBe('OUTRO');
    });
  });
});
