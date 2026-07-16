import { defineConfig } from '@playwright/test';

/**
 * Playwright para a camada "Tela" (E2E) — ADR-019. Sobe o preview do build e
 * roda os specs em `e2e/`. Sem backend: a tela de Login renderiza quando
 * `api.me()` falha (App cai em anonymous), o que basta para o smoke provar que
 * o harness roda no browser. Suíte real de fluxos cresce por fatia.
 *
 * Porta 4173 (preview padrão do Vite) para não colidir com o dev (5180).
 */
export default defineConfig({
  testDir: './e2e',
  reporter: process.env.CI ? [['json', { outputFile: 'playwright-report.json' }]] : 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
