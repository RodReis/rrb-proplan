import { describe, expect, it } from 'vitest';
import { catalogView } from './Catalog';
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
