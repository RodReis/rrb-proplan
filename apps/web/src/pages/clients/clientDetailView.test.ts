import { describe, expect, it } from 'vitest';
import type { BriefingLinkInfo, BriefingStatus, ClientProject } from '../../lib/api';
import {
  briefingStateLabel,
  briefingUrl,
  canRevoke,
  generateLabel,
  isValidTitle,
  linkStateOf,
  sortProjects,
} from './clientDetailView';

function project(over: Partial<ClientProject> = {}): ClientProject {
  return {
    id: 'p1',
    clientId: 'c1',
    title: 'Site institucional',
    description: null,
    state: 'DRAFT',
    createdAt: '2026-07-26T12:00:00Z',
    updatedAt: '2026-07-26T12:00:00Z',
    ...over,
  };
}

function activeLink(over: Partial<Extract<BriefingLinkInfo, { active: true }>> = {}) {
  return {
    active: true as const,
    id: 'l1',
    expiresAt: null,
    createdAt: '2026-07-26T12:00:00Z',
    status: 'valid' as const,
    ...over,
  };
}

describe('linkStateOf', () => {
  it('sem info ou inativo é "nenhum" — a ação é gerar', () => {
    expect(linkStateOf(null)).toBe('nenhum');
    expect(linkStateOf({ active: false })).toBe('nenhum');
  });

  it('reconhece válido, expirado e revogado', () => {
    expect(linkStateOf(activeLink({ status: 'valid' }))).toBe('valido');
    expect(linkStateOf(activeLink({ status: 'expired' }))).toBe('expirado');
    expect(linkStateOf(activeLink({ status: 'revoked' }))).toBe('revogado');
  });

  // "Existe mas não vale nada" pede a mesma ação que "não existe": gerar.
  it('status "invalid" colapsa em "nenhum", não vira rótulo próprio', () => {
    expect(linkStateOf(activeLink({ status: 'invalid' }))).toBe('nenhum');
  });
});

describe('generateLabel', () => {
  // O rótulo tem de mudar: regenerar REVOGA o anterior, e quem lê "Gerar link"
  // não espera invalidar o que já mandou para o cliente.
  it('sem link diz "Gerar"; com qualquer link diz "Regenerar"', () => {
    expect(generateLabel('nenhum')).toBe('Gerar link');
    expect(generateLabel('valido')).toBe('Regenerar link');
    expect(generateLabel('expirado')).toBe('Regenerar link');
    expect(generateLabel('revogado')).toBe('Regenerar link');
  });
});

describe('canRevoke', () => {
  it('só revoga o que ainda pode ser usado', () => {
    expect(canRevoke('valido')).toBe(true);
    expect(canRevoke('nenhum')).toBe(false);
    expect(canRevoke('expirado')).toBe(false);
    expect(canRevoke('revogado')).toBe(false);
  });
});

describe('briefingUrl', () => {
  it('monta a URL no caminho da rota pública da web', () => {
    expect(briefingUrl('tok123', 'https://proplan.rrbtrading.com.br')).toBe(
      'https://proplan.rrbtrading.com.br/b/tok123',
    );
  });

  it('não duplica a barra quando a base já termina com uma', () => {
    expect(briefingUrl('tok', 'http://localhost:5180/')).toBe(
      'http://localhost:5180/b/tok',
    );
  });

  // O bug que isto barra (achado em PRODUÇÃO pelo PI, FIX #136): a URL apontava
  // para `api.proplan…` e devolvia `{"status":"valid"}` cru ao cliente do
  // prestador. O link tem de abrir a página da web — quem o recebe é uma pessoa,
  // não um programa.
  it('aponta para a web, nunca para o subdomínio da API', () => {
    const prod = briefingUrl('tok', 'https://proplan.rrbtrading.com.br');
    expect(prod).not.toContain('api.');

    const dev = briefingUrl('tok', 'http://localhost:5180');
    expect(dev).toContain(':5180');
    expect(dev).not.toContain(':3311');
  });
});

describe('sortProjects', () => {
  it('mais recente primeiro', () => {
    const ordered = sortProjects([
      project({ id: 'velho', createdAt: '2026-07-20T10:00:00Z' }),
      project({ id: 'novo', createdAt: '2026-07-26T10:00:00Z' }),
      project({ id: 'meio', createdAt: '2026-07-23T10:00:00Z' }),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(['novo', 'meio', 'velho']);
  });

  it('não muta a lista recebida', () => {
    const original = [
      project({ id: 'a', createdAt: '2026-07-20T10:00:00Z' }),
      project({ id: 'b', createdAt: '2026-07-26T10:00:00Z' }),
    ];
    sortProjects(original);
    expect(original.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('lista vazia devolve vazia', () => {
    expect(sortProjects([])).toEqual([]);
  });
});

describe('isValidTitle', () => {
  it('recusa vazio e só-espaço — não dispara request que já se sabe que falha', () => {
    expect(isValidTitle('')).toBe(false);
    expect(isValidTitle('   ')).toBe(false);
    expect(isValidTitle('\n\t ')).toBe(false);
  });

  it('aceita título com conteúdo', () => {
    expect(isValidTitle('Site')).toBe(true);
    expect(isValidTitle('  Site  ')).toBe(true);
  });
});

/**
 * O rótulo do estado do briefing (SPEC-031 §6). Mesma razão do `linkStateOf`:
 * dizer "recebido" para um briefing que ninguém enviou passa numa revisão
 * visual, mas é o prestador esperando um trabalho que não chegou.
 */
describe('briefingStateLabel', () => {
  function status(over: Partial<BriefingStatus> = {}): BriefingStatus {
    return {
      state: 'not_started',
      completedSteps: null,
      totalSteps: 9,
      receivedAt: null,
      versions: [],
      ...over,
    };
  }

  it('sem status (a chamada falhou) cai no default honesto', () => {
    expect(briefingStateLabel(null)).toMatch(/não iniciado/i);
  });

  it('não iniciado', () => {
    expect(briefingStateLabel(status())).toMatch(/não iniciado/i);
  });

  it('em preenchimento carrega o progresso, não só o estado', () => {
    const label = briefingStateLabel(
      status({ state: 'in_progress', completedSteps: 4 }),
    );
    expect(label).toMatch(/em preenchimento/i);
    expect(label).toContain('4 de 9');
  });

  it('recebido mostra a data do envio', () => {
    expect(
      briefingStateLabel(
        status({ state: 'received', receivedAt: '2026-07-26T13:00:00Z' }),
      ),
    ).toMatch(/recebido em 26\/07\/2026/i);
  });

  it('recebido sem data não inventa "Invalid Date" na tela', () => {
    expect(
      briefingStateLabel(status({ state: 'received', receivedAt: null })),
    ).toBe('briefing recebido');
    expect(
      briefingStateLabel(status({ state: 'received', receivedAt: 'lixo' })),
    ).toBe('briefing recebido');
  });
});
