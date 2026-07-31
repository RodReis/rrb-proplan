import { afterEach, describe, expect, it } from 'vitest';
import {
  clearActiveTenant,
  getActiveTenant,
  setActiveTenant,
  withTenantPrefix,
} from './api';

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
    // SPEC-033 §6. As duas primeiras já cairiam em `/client-projects`, mas
    // estão aqui porque é a regressão que interessa — não a implementação
    // atual da lista.
    [
      '/client-projects/cp-1/effort-breakdown',
      '/t/T/client-projects/cp-1/effort-breakdown',
    ],
    ['/client-projects/cp-1/estimates', '/t/T/client-projects/cp-1/estimates'],
    ['/estimates/e-1', '/t/T/estimates/e-1'],
    ['/estimates/e-1/approve', '/t/T/estimates/e-1/approve'],
    ['/tenant-settings', '/t/T/tenant-settings'],
    // SPEC-035 §6 — as três rotas do dashboard. O contador é o caso caro: sem
    // prefixo ele sairia 404 e a tela mostraria **zero**, indistinguível de
    // "nada esperando por você". Um contador que mente é pior que nenhum (§2.3).
    ['/dashboard', '/t/T/dashboard'],
    ['/dashboard?period=90', '/t/T/dashboard?period=90'],
    ['/dashboard/pending-count', '/t/T/dashboard/pending-count'],
    ['/dashboard/settings', '/t/T/dashboard/settings'],
    // O bloco ao vivo (§2.6). Sem prefixo, viria 404 e a tela mostraria o bloco
    // vazio — indistinguível de "nenhum repo", que é a leitura que o §2.11
    // existe para impedir.
    ['/dashboard/repos', '/t/T/dashboard/repos'],
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

  it.each([
    '/licensing/releases',
    '/licensing/releases/rel-1/unpublish',
    '/licensing/releases/rel-1/publish',
  ])('%s recebe o prefixo do tenant (SPEC-041)', (path) => {
    // As rotas de release do ADMIN vivem sob `/t/:tenant`. O prefixo
    // `/licensing/` já cobria as da SPEC-036, então nenhuma linha nova foi
    // precisa — mas o FIX #166 aconteceu justamente por isso ser fácil de
    // presumir. Aqui a cobertura é afirmada, não suposta.
    setActiveTenant(TENANT);
    expect(withTenantPrefix(path)).toBe(`/t/${TENANT}${path}`);
  });

  it('sem tenant ativo, nada é prefixado', () => {
    // O backend responde 401/403 e o app manda para o catálogo. Prefixar com
    // `undefined` produziria uma URL quebrada e um erro pior de diagnosticar.
    setActiveTenant(null);
    expect(withTenantPrefix('/artifacts/a-1/approve')).toBe('/artifacts/a-1/approve');
  });
});

/**
 * `clearActiveTenant` — a corrida entre rotas irmãs (FIX #230).
 *
 * Ao navegar de Licenças para o Catálogo, o React monta a rota nova **antes**
 * de desmontar a velha. Com `setActiveTenant(null)` cru no cleanup, a ordem
 * real era:
 *
 * 1. `AppShell` do Catálogo renderiza e fixa o tenant;
 * 2. `ClientsRoute` desmonta e zera o tenant recém-fixado.
 *
 * O sintoma era o item **Dashboard sumindo do menu** ao clicar em ProPlan: sem
 * prefixo, `/dashboard` devolvia 404 e o `catch` deixava `hasClients` em
 * `false` — indistinguível da regra legítima da SPEC-035 §2.12 ("some sem
 * cliente nenhum"), que é o que fez o bug sobreviver a duas rodadas de conserto.
 *
 * Estes testes moram aqui, e não num componente, porque a lição do topo deste
 * arquivo se aplica inteira: **mockar a fronteira esconde defeitos DA
 * fronteira**. Os testes de `AppShell` mockam `setActiveTenant` e nunca veriam
 * a ordem real das chamadas.
 */
describe('clearActiveTenant: quem sai não apaga o tenant de quem chegou', () => {
  const OUTRO = '00000000-0000-4000-8000-000000000002';

  it('limpa quando o tenant ainda é o que o chamador fixou', () => {
    setActiveTenant(TENANT);

    clearActiveTenant(TENANT);

    expect(getActiveTenant()).toBeNull();
  });

  it('NÃO limpa quando outra rota já assumiu — o caso do bug', () => {
    // A sequência exata da navegação Licenças → ProPlan.
    setActiveTenant(TENANT); // ClientsRoute fixou ao entrar em Licenças
    setActiveTenant(OUTRO); // AppShell do Catálogo assumiu na render

    clearActiveTenant(TENANT); // cleanup ATRASADO do ClientsRoute

    expect(getActiveTenant()).toBe(OUTRO);
  });

  it('a URL continua prefixada depois do cleanup atrasado', () => {
    // O que o operador via: sem esta garantia, `/dashboard` sairia cru, a API
    // devolveria 404 e o item sumiria do menu.
    setActiveTenant(TENANT);
    setActiveTenant(OUTRO);

    clearActiveTenant(TENANT);

    expect(withTenantPrefix('/dashboard')).toBe(`/t/${OUTRO}/dashboard`);
  });

  it('limpar com `null` só zera se não houver tenant fixado', () => {
    // Chamador que nunca fixou nada (sessão sem membership) não pode derrubar
    // o tenant de quem fixou.
    setActiveTenant(TENANT);

    clearActiveTenant(null);

    expect(getActiveTenant()).toBe(TENANT);
  });
});
