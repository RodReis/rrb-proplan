/**
 * Jest com dois projects (ADR-019 §3): a categoria do relatório é determinística
 * por sufixo/diretório, o gerador não adivinha.
 *  - `regras`: unidade pura, sem DB/rede — arquivos `.spec.ts` em src (exclui int-spec).
 *  - `banco`:  integração/e2e — `.int-spec.ts` em src + `.e2e-spec.ts` em test.
 *
 * Rodar um project isolado: `jest --selectProjects regras` (usado pelo CI e pelo
 * gen-test-report para gerar um JSON por categoria).
 */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: '.',
};

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  projects: [
    {
      ...base,
      displayName: 'regras',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      testPathIgnorePatterns: ['\\.int-spec\\.ts$'],
    },
    {
      ...base,
      displayName: 'banco',
      testMatch: [
        '<rootDir>/src/**/*.int-spec.ts',
        '<rootDir>/test/**/*.e2e-spec.ts',
      ],
      // Serial: as suítes de integração compartilham o mesmo Postgres de teste;
      // rodar em paralelo faz seed/contexto de uma vazar na outra (RLS + SET
      // LOCAL numa conexão reusada). Banco real = execução sequencial.
      maxWorkers: 1,
    },
  ],
};
