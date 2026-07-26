import { describe, expect, it } from 'vitest';
import type { BriefingLinkInfo, ClientProject } from '../../lib/api';
import {
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
  it('monta a URL no caminho do BriefingPublicController', () => {
    expect(briefingUrl('tok123', 'https://api.proplan.rrbtrading.com.br')).toBe(
      'https://api.proplan.rrbtrading.com.br/b/tok123',
    );
  });

  it('não duplica a barra quando a base já termina com uma', () => {
    expect(briefingUrl('tok', 'http://localhost:3311/')).toBe(
      'http://localhost:3311/b/tok',
    );
  });

  // O bug que isto barra: a 1ª versão usava `window.location.origin` (a web) e
  // gerava um link que caía na tela de login — `/b/:token` é rota do NestJS, e o
  // React Router não tem `/b` nenhum. Achado no dogfooding do PI.
  it('aponta para a API, nunca para a origem da web', () => {
    const url = briefingUrl('tok', 'http://localhost:3311');
    expect(url).toContain(':3311');
    expect(url).not.toContain(':5180');
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
