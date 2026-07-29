import { describe, expect, it } from 'vitest';
import type { LicenseView } from '../../lib/api';
import {
  eventLabel,
  isAtMachineLimit,
  machinesLabel,
  searchMode,
  shortDate,
  shortDateTime,
  statusLabel,
  statusTone,
  updatesLabel,
} from './licensingView';

const BASE: LicenseView = {
  id: 'lic-1',
  status: 'ACTIVE',
  customerEmail: 'comprador@exemplo.com',
  customerName: 'Comprador',
  editionSlug: 'closed',
  editionName: 'Sem código-fonte',
  productSlug: 'warroom',
  issuedAt: '2026-07-29T12:00:00Z',
  updatesUntil: '2027-07-29T12:00:00Z',
  expiresAt: null,
  revokedAt: null,
  revokedReason: null,
  activeMachines: 1,
  maxMachines: 2,
};

describe('SPEC-036: apresentação da tela de licenças', () => {
  describe('status', () => {
    it.each([
      ['ACTIVE', 'Ativa'],
      ['REVOKED', 'Revogada'],
      ['EXPIRED', 'Expirada'],
    ] as const)('%s → %s', (status, esperado) => {
      expect(statusLabel(status)).toBe(esperado);
    });

    it('revogada e expirada compartilham o tom de alerta', () => {
      // Do ponto de vista de quem olha, os dois dizem a mesma coisa: esta chave
      // não ativa mais. O texto distingue o motivo; a cor não precisa.
      expect(statusTone('ACTIVE')).toBe('ok');
      expect(statusTone('REVOKED')).toBe('alert');
      expect(statusTone('EXPIRED')).toBe('alert');
    });
  });

  describe('máquinas', () => {
    it('mostra o número por extenso, não porcentagem', () => {
      // Com teto de 2, uma barra transformaria "uma máquina" em "50%" — precisão
      // inventada sobre um número que cabe por extenso.
      expect(machinesLabel(BASE)).toBe('1 de 2 máquinas');
    });

    it('singulariza quando o teto é 1', () => {
      expect(machinesLabel({ ...BASE, activeMachines: 1, maxMachines: 1 })).toBe(
        '1 de 1 máquina',
      );
    });

    it('detecta o limite atingido — a próxima ativação recebe 409', () => {
      expect(isAtMachineLimit({ ...BASE, activeMachines: 1 })).toBe(false);
      expect(isAtMachineLimit({ ...BASE, activeMachines: 2 })).toBe(true);
    });
  });

  describe('datas', () => {
    it('nulo vira travessão, nunca "null" nem data vazia', () => {
      // A ausência é informação (ADR-014) e precisa parecer ausência.
      expect(shortDate(null)).toBe('—');
      expect(shortDateTime(null)).toBe('—');
    });

    it('data inválida também vira travessão', () => {
      // "Invalid Date" na tela é pior que travessão: parece dado, e não é.
      expect(shortDate('não-é-data')).toBe('—');
      expect(shortDateTime('')).toBe('—');
    });

    it('formata em pt-BR', () => {
      expect(shortDate('2026-07-29T12:00:00Z')).toContain('2026');
      expect(shortDateTime('2026-07-29T12:00:00Z')).toMatch(/\d{2}:\d{2}/);
    });
  });

  describe('updates', () => {
    it('janela aberta diz "até"', () => {
      expect(updatesLabel(BASE, new Date('2026-08-01T00:00:00Z'))).toMatch(/^Updates até/);
    });

    it('janela vencida diz "encerrados", não "expirada"', () => {
      // `updatesUntil` vencido NÃO impede o produto de rodar: a perpétua
      // continua válida (MVP4 decisão 3), o que vence é o direito a versões
      // novas. "Expirada" faria o suporte acreditar que a licença morreu.
      const rotulo = updatesLabel(BASE, new Date('2028-01-01T00:00:00Z'));
      expect(rotulo).toMatch(/^Updates encerrados/);
      expect(rotulo).not.toMatch(/expirad/i);
    });

    it('data inválida vira travessão em vez de rótulo errado', () => {
      expect(updatesLabel({ ...BASE, updatesUntil: 'x' })).toBe('—');
    });
  });

  describe('trilha', () => {
    it.each([
      ['issued', 'Licença emitida'],
      ['activated', 'Máquina ativada'],
      ['reactivated', 'Máquina reativada'],
      ['revoked', 'Licença revogada'],
    ])('%s → %s', (type, esperado) => {
      expect(eventLabel(type)).toBe(esperado);
    });

    it('tipo desconhecido cai no nome cru, não some', () => {
      // As fatias 27–28 acrescentam `webhook_renewed` e `source_invited`. Uma
      // lista que omite o que não reconhece mente por omissão.
      expect(eventLabel('webhook_renewed')).toBe('webhook_renewed');
    });
  });

  describe('busca', () => {
    it('texto com @ busca por e-mail', () => {
      expect(searchMode('  ana@exemplo.com ')).toEqual({ email: 'ana@exemplo.com' });
    });

    it('texto sem @ busca por chave', () => {
      // Um campo só, não dois: quem usa é o suporte com o que o comprador
      // mandou. Escolher o tipo antes de digitar é burocracia sobre a
      // informação que ele já tem na mão.
      expect(searchMode('WR-AB23-CD45-EF67-GH89')).toEqual({
        key: 'WR-AB23-CD45-EF67-GH89',
      });
    });

    it('texto vazio não busca nada', () => {
      expect(searchMode('')).toBeNull();
      expect(searchMode('   ')).toBeNull();
    });
  });
});
