import { defineConfig } from 'vitest/config';

/**
 * Vitest para a camada "Tela" (componente) — ADR-019. Playwright (E2E) roda à
 * parte, em `e2e/`, e é excluído daqui. Cobertura em json-summary para o gerador
 * de relatório ler o número; resultados em JSON no CI via `--reporter=json`.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**'],
    },
  },
});
