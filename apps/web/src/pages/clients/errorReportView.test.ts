import { describe, expect, it } from 'vitest';
import type { LicErrorReportView } from '../../lib/api';
import {
  errorStatusLabel,
  errorStatusTone,
  newCount,
  nextStatus,
  nextStatusLabel,
  sessionTailText,
  sourceLabel,
  versionsOf,
} from './errorReportView';

const relato = (
  id: string,
  status: LicErrorReportView['status'],
  appVersion = '1.0.0',
  receivedAt = '2026-08-01T10:00:00Z',
): LicErrorReportView => ({
  id,
  message: 'Erro',
  appVersion,
  os: 'win-x64',
  source: 'CRASH',
  status,
  occurredAt: receivedAt,
  receivedAt,
  licenseId: 'lic-1',
});

describe('errorStatusTone', () => {
  it('só NEW é alerta — é o único que pede ação', () => {
    // Pintar TRIAGED de alerta diria "isto também está pendente" sobre algo que
    // alguém já pegou. Cor carrega significado (DESIGN.md §1).
    expect(errorStatusTone('NEW')).toBe('alert');
    expect(errorStatusTone('TRIAGED')).toBe('muted');
    expect(errorStatusTone('RESOLVED')).toBe('ok');
  });

  it('rotula os três estados em português', () => {
    expect(errorStatusLabel('NEW')).toBe('novo');
    expect(errorStatusLabel('TRIAGED')).toBe('em análise');
    expect(errorStatusLabel('RESOLVED')).toBe('resolvido');
  });
});

describe('sourceLabel', () => {
  it('distingue crash de envio voluntário', () => {
    // A distinção importa na triagem: um relato manual costuma vir com nota do
    // usuário e e-mail de contato; um crash, não.
    expect(sourceLabel('CRASH')).toBe('crash automático');
    expect(sourceLabel('MANUAL')).toBe('enviado pelo usuário');
  });
});

describe('newCount', () => {
  it('conta só os que ninguém olhou', () => {
    expect(
      newCount([relato('a', 'NEW'), relato('b', 'TRIAGED'), relato('c', 'NEW')]),
    ).toBe(2);
  });

  it('lista vazia não é zero acidental', () => {
    expect(newCount([])).toBe(0);
  });
});

describe('nextStatus', () => {
  it('avança NEW → TRIAGED → RESOLVED', () => {
    expect(nextStatus('NEW')).toBe('TRIAGED');
    expect(nextStatus('TRIAGED')).toBe('RESOLVED');
  });

  it('RESOLVED volta para NEW — reabrir é caso real', () => {
    // Sem a volta, desfazer um clique errado exigiria um segundo controle.
    expect(nextStatus('RESOLVED')).toBe('NEW');
  });

  it('o rótulo do botão acompanha o próximo estado', () => {
    expect(nextStatusLabel('NEW')).toBe('Analisar');
    expect(nextStatusLabel('TRIAGED')).toBe('Resolver');
    expect(nextStatusLabel('RESOLVED')).toBe('Reabrir');
  });
});

describe('versionsOf', () => {
  it('deduplica e ordena pela chegada mais recente', () => {
    const lista = [
      relato('a', 'NEW', '1.0.0', '2026-07-01T10:00:00Z'),
      relato('b', 'NEW', '1.2.0', '2026-08-01T10:00:00Z'),
      relato('c', 'NEW', '1.0.0', '2026-07-15T10:00:00Z'),
    ];

    expect(versionsOf(lista)).toEqual(['1.2.0', '1.0.0']);
  });

  it('não muta a lista recebida', () => {
    const lista = [
      relato('a', 'NEW', '1.0.0', '2026-07-01T10:00:00Z'),
      relato('b', 'NEW', '1.2.0', '2026-08-01T10:00:00Z'),
    ];
    const antes = lista.map((r) => r.id);

    versionsOf(lista);

    expect(lista.map((r) => r.id)).toEqual(antes);
  });

  it('lista vazia devolve vazio', () => {
    expect(versionsOf([])).toEqual([]);
  });
});

describe('sessionTailText', () => {
  it('formata objeto como JSON legível', () => {
    expect(sessionTailText({ arquivos: ['a.ts'] })).toBe(
      '{\n  "arquivos": [\n    "a.ts"\n  ]\n}',
    );
  });

  it('string passa direto', () => {
    expect(sessionTailText('abriu a.ts')).toBe('abriu a.ts');
  });

  it('ausente vira null, e a tela omite o bloco', () => {
    expect(sessionTailText(null)).toBeNull();
    expect(sessionTailText(undefined)).toBeNull();
  });

  it('valor circular não derruba a tela', () => {
    // O `sessionTail` vem da máquina de outra pessoa por rota pública. Um throw
    // aqui apagaria a aba inteira do operador.
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(sessionTailText(circular)).toBeNull();
  });
});
