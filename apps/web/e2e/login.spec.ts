import { expect, test } from '@playwright/test';

/**
 * Smoke E2E da camada "Tela" (ADR-019): prova que o build carrega no browser e
 * a tela de Login renderiza (App cai em anonymous quando não há sessão). Sem
 * backend — é o menor E2E que exercita o app real de ponta a ponta.
 */
test('tela de Login carrega e mostra o CTA do GitHub', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('RRB ProPlan')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Entrar com GitHub/i }),
  ).toBeVisible();
});
