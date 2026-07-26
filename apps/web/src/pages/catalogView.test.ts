import { describe, expect, it } from 'vitest';
import {
  catalogPageSizeForViewport,
  catalogRows,
  catalogView,
  filterCatalogRows,
} from './Catalog';
import type { CatalogInstallations } from '../lib/api';

/**
 * O que o Catálogo mostra ao desconectar (SPEC-025 §3/§4).
 *
 * O erro que estes testes existem para barrar é tratar "desconectado" como
 * "vazio": os dois chegam com `groups: []`, mas pedem telas opostas — reconectar
 * num caso, instalar o App no outro.
 */
const VAZIO: CatalogInstallations = { groups: [], empty: true };
const COM_REPOS: CatalogInstallations = {
  groups: [{ installationId: 1 } as CatalogInstallations['groups'][number]],
  empty: false,
};
const CATALOGO: CatalogInstallations = {
  empty: false,
  groups: [
    {
      installationId: 1,
      tenantId: 't1',
      account: 'RodrigoReis',
      accountType: 'User',
      repos: [
        {
          githubRepoId: 10,
          owner: 'RodrigoReis',
          name: 'rrb-proplan',
          description: 'Painel de governança',
          defaultBranch: 'main',
          isPrivate: true,
          pushedAt: '2026-07-24T10:00:00.000Z',
          installationId: 1,
          managedProjectId: 'p1',
        },
        {
          githubRepoId: 11,
          owner: 'RodrigoReis',
          name: 'rrb-briefing',
          description: 'SaaS de briefing',
          defaultBranch: 'main',
          isPrivate: false,
          pushedAt: '2026-07-26T10:00:00.000Z',
          installationId: 1,
          managedProjectId: null,
        },
      ],
    },
    {
      installationId: 2,
      tenantId: 't2',
      account: 'RRB-Org',
      accountType: 'Organization',
      repos: [
        {
          githubRepoId: 12,
          owner: 'RRB-Org',
          name: 'docs',
          description: null,
          defaultBranch: 'main',
          isPrivate: false,
          pushedAt: '2026-07-25T10:00:00.000Z',
          installationId: 2,
          managedProjectId: 'p2',
        },
      ],
    },
  ],
};

describe('catalogView', () => {
  it('sem conexão: cards read-only do índice local', () => {
    expect(catalogView(false, VAZIO)).toBe('offline');
  });

  it('sem conexão nunca oferece instalar, mesmo com catálogo vazio', () => {
    // O CTA certo aqui é reconectar (card de conexão), não ir ao github.com.
    expect(catalogView(false, VAZIO)).not.toBe('install');
  });

  it('conectado e sem instalação: CTA de instalar o App', () => {
    expect(catalogView(true, VAZIO)).toBe('install');
  });

  it('conectado com repositórios: lista os grupos', () => {
    expect(catalogView(true, COM_REPOS)).toBe('groups');
  });

  it('estado ainda desconhecido: não decide nada', () => {
    // Evita piscar "conecte o GitHub" antes da resposta do servidor.
    expect(catalogView(null, VAZIO)).toBe('unknown');
  });
});

describe('filterCatalogRows', () => {
  it('busca por repo, conta e descrição', () => {
    const rows = catalogRows(CATALOGO);

    expect(filterCatalogRows(rows, 'briefing', 'all', 'name').map((row) => row.repo.name)).toEqual([
      'rrb-briefing',
    ]);
    expect(filterCatalogRows(rows, 'rrb-org', 'all', 'name').map((row) => row.repo.name)).toEqual([
      'docs',
    ]);
    expect(filterCatalogRows(rows, 'governança', 'all', 'name').map((row) => row.repo.name)).toEqual([
      'rrb-proplan',
    ]);
  });

  it('filtra por estado e privacidade', () => {
    const rows = catalogRows(CATALOGO);

    expect(filterCatalogRows(rows, '', 'managed', 'name').map((row) => row.repo.name)).toEqual([
      'docs',
      'rrb-proplan',
    ]);
    expect(filterCatalogRows(rows, '', 'unmanaged', 'name').map((row) => row.repo.name)).toEqual([
      'rrb-briefing',
    ]);
    expect(filterCatalogRows(rows, '', 'private', 'name').map((row) => row.repo.name)).toEqual([
      'rrb-proplan',
    ]);
  });

  it('ordena estado priorizando gerenciados e depois último push', () => {
    const rows = catalogRows(CATALOGO);

    expect(filterCatalogRows(rows, '', 'all', 'status').map((row) => row.repo.name)).toEqual([
      'docs',
      'rrb-proplan',
      'rrb-briefing',
    ]);
  });
});

describe('catalogPageSizeForViewport', () => {
  it('usa mais linhas em desktop alto e reduz no mobile', () => {
    expect(catalogPageSizeForViewport(1440, 900)).toBe(9);
    expect(catalogPageSizeForViewport(1440, 740)).toBe(6);
    expect(catalogPageSizeForViewport(390, 844)).toBe(5);
  });
});
