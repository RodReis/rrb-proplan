import { expect, test } from '@playwright/test';

/**
 * Smoke E2E da camada "Tela" (ADR-019): prova que o build carrega no browser e
 * a tela de Login renderiza (App cai em anonymous quando não há sessão). Sem
 * backend — é o menor E2E que exercita o app real de ponta a ponta.
 *
 * Ancorado no que a tela promete, não em texto decorativo: o título da ação e
 * o CTA do OAuth. O teste anterior procurava "RRB ProPlan", que era o título
 * do login pré-Fatia 16 e sumiu no redesenho — âncora frágil.
 *
 * O CTA é o do **Google** desde a SPEC-026: a identidade é o IdP, e o GitHub
 * virou conexão — pedida de dentro do painel, não na porta de entrada.
 */
test('tela de Login carrega e mostra o CTA do Google', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar no painel' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Entrar com Google/i }),
  ).toBeVisible();
  // Entrar ≠ conectar: a tela precisa dizer que o GitHub vem depois.
  await expect(page.getByText(/A conexão com o GitHub é feita depois/i)).toBeVisible();
});

/**
 * O tema é escolhido antes de autenticar (SPEC-021): quem nunca entrou ainda
 * decide como quer ver. Carbono é o padrão (DESIGN.md §4).
 */
test('login abre no tema Carbono e o toggle troca para Claro', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'carbono');

  await page.getByRole('button', { name: /Mudar para o tema Claro/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');

  // A escolha sobrevive ao reload — é o critério de aceite da SPEC-020.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');
});
