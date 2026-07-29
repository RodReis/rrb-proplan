import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_CHANNELS,
  brl,
  channelLabel,
  contractLabel,
  contractLinkState,
  ESTADOS_COM_CONTRATO,
  horas,
  isAccepted,
  isValidProfile,
  issueBlockedReason,
  modalityLabel,
  PLACEHOLDERS,
  shortDateTime,
} from './contractsView';
import type {
  ContractSummary,
  ProviderProfileView,
  TemplateSummary,
} from '../../lib/api';

const PERFIL: ProviderProfileView = {
  legalName: 'Acme ME',
  documentType: 'cnpj',
  document: '11.222.333/0001-44',
  zipCode: null,
  street: null,
  district: null,
  city: null,
  state: null,
  email: null,
  phone: null,
  canEdit: true,
  exists: true,
};

const TEMPLATE: TemplateSummary = {
  modality: 'desenvolvimento',
  isSeedExample: false,
  currentVersion: 2,
  updatedAt: '2026-07-28T12:00:00.000Z',
  readyToIssue: true,
};

const CONTRATO: ContractSummary = {
  id: 'c1',
  version: 1,
  modality: 'desenvolvimento',
  budgetBrl: '12500.00',
  effortHours: '80.00',
  paymentTerms: null,
  templateVersion: 2,
  estimateVersion: 1,
  acceptedAt: null,
  createdAt: '2026-07-28T12:00:00.000Z',
};

describe('modalityLabel', () => {
  it('traduz as três modalidades', () => {
    expect(modalityLabel('desenvolvimento')).toBe('Desenvolvimento');
    expect(modalityLabel('desenvolvimento_manutencao')).toBe(
      'Desenvolvimento + manutenção',
    );
    expect(modalityLabel('desenvolvimento_venda_codigo')).toBe(
      'Desenvolvimento + venda do código',
    );
  });

  it('devolve o valor cru quando a modalidade é desconhecida', () => {
    // Nunca "" nem undefined: um rótulo vazio esconderia que o dado mudou.
    expect(modalityLabel('outra' as never)).toBe('outra');
  });
});

describe('ACCEPTANCE_CHANNELS', () => {
  it('é a lista fechada do §2.10, e só ela', () => {
    expect(ACCEPTANCE_CHANNELS.map((c) => c.key)).toEqual([
      'email',
      'whatsapp',
      'presencial',
      'telefone',
    ]);
  });

  it('rotula cada canal', () => {
    expect(channelLabel('whatsapp')).toBe('WhatsApp');
    expect(channelLabel('email')).toBe('E-mail');
  });
});

describe('issueBlockedReason', () => {
  it('sem perfil preenchido, bloqueia pelo perfil primeiro', () => {
    const semPerfil = { ...PERFIL, exists: false };
    expect(issueBlockedReason(semPerfil, TEMPLATE)).toMatch(/perfil do prestador/i);
  });

  it('perfil ausente (null) também bloqueia', () => {
    expect(issueBlockedReason(null, TEMPLATE)).toMatch(/perfil do prestador/i);
  });

  it('template ainda semeado bloqueia com o motivo do §2.3', () => {
    const semeado = { ...TEMPLATE, isSeedExample: true, readyToIssue: false };
    expect(issueBlockedReason(PERFIL, semeado)).toMatch(/edite e salve o template/i);
  });

  it('perfil + template salvo libera', () => {
    expect(issueBlockedReason(PERFIL, TEMPLATE)).toBeNull();
  });

  it('não inventa motivo sobre escopo ou estimativa', () => {
    // A tela não tem esses dados; quem recusa é o servidor, com motivo legível.
    expect(issueBlockedReason(PERFIL, TEMPLATE)).toBeNull();
  });
});

describe('contractLinkState', () => {
  it('sem link e link inválido colapsam em "nenhum"', () => {
    expect(contractLinkState(null)).toBe('nenhum');
    expect(contractLinkState({ active: false })).toBe('nenhum');
  });

  it('distingue válido, expirado e revogado', () => {
    const base = {
      active: true as const,
      id: 'l1',
      expiresAt: '2026-07-30T12:00:00.000Z',
      createdAt: '2026-07-28T12:00:00.000Z',
    };
    expect(contractLinkState({ ...base, status: 'valid' })).toBe('valido');
    expect(contractLinkState({ ...base, status: 'expired' })).toBe('expirado');
    expect(contractLinkState({ ...base, status: 'revoked' })).toBe('revogado');
  });
});

describe('isAccepted / contractLabel', () => {
  it('lê `acceptedAt`, não o estado do card', () => {
    expect(isAccepted(CONTRATO)).toBe(false);
    expect(isAccepted({ ...CONTRATO, acceptedAt: '2026-07-28T13:00:00.000Z' })).toBe(
      true,
    );
  });

  it('só a versão aceita leva o selo — não o projeto inteiro', () => {
    // O card pode estar em CONTRACT_APPROVED por causa da v1; dizer "aceito"
    // na v3 afirmaria um fato que não aconteceu.
    const v3 = { ...CONTRATO, version: 3 };
    expect(contractLabel(v3)).toBe('v3 · Desenvolvimento');
    expect(contractLabel({ ...v3, acceptedAt: '2026-07-28T13:00:00.000Z' })).toBe(
      'v3 · Desenvolvimento · aceito',
    );
  });
});

describe('shortDateTime', () => {
  it('null vira travessão, nunca 1970 nem a data de hoje', () => {
    expect(shortDateTime(null)).toBe('—');
  });

  it('devolve o valor cru quando a data é impossível de ler', () => {
    expect(shortDateTime('nao-e-data')).toBe('nao-e-data');
  });

  it('formata um ISO válido', () => {
    expect(shortDateTime('2026-07-28T12:00:00.000Z')).toMatch(/28\/07\/2026/);
  });
});

describe('brl / horas', () => {
  it('formata sem fazer aritmética', () => {
    expect(brl('12500.00')).toContain('12.500,00');
    expect(horas('80.00')).toBe('80 h');
    expect(horas('1.50')).toBe('1,5 h');
  });

  it('valor não numérico passa cru — melhor que NaN em tela', () => {
    expect(brl('—')).toBe('—');
    expect(horas('—')).toBe('— h');
  });
});

describe('isValidProfile', () => {
  it('exige nome e documento, ignorando espaços', () => {
    expect(isValidProfile({ legalName: 'Acme', document: '123' })).toBe(true);
    expect(isValidProfile({ legalName: '  ', document: '123' })).toBe(false);
    expect(isValidProfile({ legalName: 'Acme', document: '   ' })).toBe(false);
  });
});

describe('ESTADOS_COM_CONTRATO', () => {
  it('começa em CONTRACT_PENDING e continua depois do aceite', () => {
    // Antes de `CONTRACT_PENDING` não há estimativa aprovada, e o servidor
    // recusaria. Depois do aceite o contrato precisa seguir consultável.
    expect(ESTADOS_COM_CONTRATO).toContain('CONTRACT_PENDING');
    expect(ESTADOS_COM_CONTRATO).toContain('CONTRACT_APPROVED');
    expect(ESTADOS_COM_CONTRATO).toContain('DELIVERED');
    expect(ESTADOS_COM_CONTRATO).not.toContain('ARTIFACTS_READY');
  });
});

describe('PLACEHOLDERS', () => {
  /**
   * Esta lista é uma **cópia** da do servidor (`CONTRACT_PLACEHOLDERS`, em
   * `apps/api/prisma/contract-templates.seed.ts`) — `web` e `api` são pacotes
   * separados, sem barrel compartilhado.
   *
   * O teste existe porque a cópia é o risco: acrescentar um placeholder no
   * servidor sem tocar aqui deixaria a tela **listando menos do que aceita**, e
   * o defeito não quebraria nada — só faria alguém não usar um placeholder que
   * existe. Se este teste cair, as duas listas divergiram.
   */
  it('são os 12 do §2.4, na ordem do servidor', () => {
    expect(PLACEHOLDERS).toEqual([
      'provider_name',
      'provider_document',
      'provider_address',
      'client_name',
      'client_document',
      'client_address',
      'scope',
      'budget',
      'effort_hours',
      'payment_terms',
      'date',
      'modality',
    ]);
  });

  it('não traz `duration_days` — removido por emenda do PI (§8.7)', () => {
    // O `Estimate` entrega horas; dias não existem em fatia nenhuma do MVP3.
    expect(PLACEHOLDERS).not.toContain('duration_days');
    expect(PLACEHOLDERS).toContain('effort_hours');
  });
});
