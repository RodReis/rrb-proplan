import { describe, expect, it } from 'vitest';
import type { ResolvedRoute } from '../../lib/api';
import { canonicalUrl } from './canonicalUrl';

const PROPLAN: ResolvedRoute = {
  tenantId: '00000000-0000-4000-8000-e48e206abe39',
  projectId: '402e31cc-0895-40c1-a5a3-b0408ca442df',
  tenantSlug: 'rodreis',
  projectSlug: 'rrb-proplan',
};

const JARVIS: ResolvedRoute = {
  tenantId: PROPLAN.tenantId,
  projectId: 'f1a9c0de-0000-4000-8000-000000000001',
  tenantSlug: 'rodreis',
  projectSlug: 'rrb-jarvisos',
};

describe('canonicalUrl', () => {
  it('não reescreve URL que já está na forma canônica', () => {
    expect(canonicalUrl(PROPLAN, 'rodreis', 'rrb-proplan', 'overview')).toBeNull();
  });

  it('canoniza uuid para slug', () => {
    expect(canonicalUrl(PROPLAN, 'rodreis', PROPLAN.projectId, 'kanban')).toBe(
      '/t/rodreis/p/rrb-proplan/kanban',
    );
  });

  it('canoniza caixa diferente para slug minúsculo', () => {
    expect(canonicalUrl(JARVIS, 'rodreis', 'rrb-jarvisOS', 'kanban')).toBe(
      '/t/rodreis/p/rrb-jarvisos/kanban',
    );
  });

  it('preserva query e hash', () => {
    expect(canonicalUrl(PROPLAN, 'rodreis', PROPLAN.projectId, 'kanban', '?f=1#x')).toBe(
      '/t/rodreis/p/rrb-proplan/kanban?f=1#x',
    );
  });

  // A regressão: trocar de projeto no combo. O efeito de canonização roda com a
  // URL já apontando para o jarvis e a resolução ainda do proplan. Reescrever
  // aqui devolvia a URL para o projeto anterior — a troca piscava e voltava.
  it('descarta resolução obsoleta em vez de desfazer a troca de projeto', () => {
    expect(canonicalUrl(PROPLAN, 'rodreis', 'rrb-jarvisos', 'overview')).toBeNull();
  });

  it('descarta resolução obsoleta de tenant', () => {
    expect(canonicalUrl(PROPLAN, 'outro-tenant', 'rrb-proplan', 'overview')).toBeNull();
  });

  it('sem aba na URL, canoniza sem sufixo', () => {
    expect(canonicalUrl(PROPLAN, 'rodreis', PROPLAN.projectId, undefined)).toBe(
      '/t/rodreis/p/rrb-proplan',
    );
  });
});
