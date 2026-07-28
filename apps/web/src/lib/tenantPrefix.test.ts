import { afterEach, describe, expect, it } from 'vitest';
import { setActiveTenant, withTenantPrefix } from './api';

/**
 * Quais caminhos recebem o prefixo `/t/:tenant` (SPEC-022).
 *
 * **Este arquivo nasceu de um bug do dogfooding da SPEC-032.** A lista
 * `TENANT_SCOPED_PREFIXES` não incluía `/artifacts/`, então ver versão,
 * aprovar, rejeitar e editar saíam SEM tenant e a API devolvia 404. A tela
 * mostrava vazio, sem mensagem de erro.
 *
 * Nenhum teste pegou porque **todos mockam a camada de API inteira** — e é
 * exatamente aqui que a função vive. Testes de componente provam que a tela
 * chama `getArtifactVersion`; nenhum provava que a URL montada estava certa.
 *
 * A lição, que é o motivo deste arquivo existir: mockar a fronteira esconde
 * defeitos DA fronteira.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';

afterEach(() => setActiveTenant(null));

describe('withTenantPrefix: rotas escopadas por tenant', () => {
  it.each([
    ['/clients', '/t/T/clients'],
    ['/client-projects/cp-1/artifacts', '/t/T/client-projects/cp-1/artifacts'],
    ['/briefing-versions/bv-1', '/t/T/briefing-versions/bv-1'],
    ['/projects/p-1/tabs', '/t/T/projects/p-1/tabs'],
    ['/files/f-1', '/t/T/files/f-1'],
    // O caso do bug: as 4 rotas de artefato do §6 da SPEC-032.
    ['/artifacts/a-1/versions/v-1', '/t/T/artifacts/a-1/versions/v-1'],
    ['/artifacts/a-1/approve', '/t/T/artifacts/a-1/approve'],
    ['/artifacts/a-1/reject', '/t/T/artifacts/a-1/reject'],
    ['/artifacts/a-1/versions', '/t/T/artifacts/a-1/versions'],
  ])('%s recebe o prefixo', (path, esperado) => {
    setActiveTenant(TENANT);
    expect(withTenantPrefix(path)).toBe(esperado.replace('/t/T', `/t/${TENANT}`));
  });

  it.each([
    '/catalog/installations',
    '/auth/session',
    '/usage/llm/current-month',
    '/portfolio',
    '/resolve/acme/repo',
    // A rota pública do briefing NÃO tem tenant por design: o dela vem do hash
    // do token (ADR-020), e quem a abre é o cliente do prestador, sem conta.
    '/b/token-do-cliente',
  ])('%s passa intacta (rota global ou pública)', (path) => {
    setActiveTenant(TENANT);
    expect(withTenantPrefix(path)).toBe(path);
  });

  it('sem tenant ativo, nada é prefixado', () => {
    // O backend responde 401/403 e o app manda para o catálogo. Prefixar com
    // `undefined` produziria uma URL quebrada e um erro pior de diagnosticar.
    setActiveTenant(null);
    expect(withTenantPrefix('/artifacts/a-1/approve')).toBe('/artifacts/a-1/approve');
  });
});
