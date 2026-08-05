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
  // Serial no nível raiz (maxWorkers por-project o jest ignora): as suítes de
  // integração do project `banco` compartilham o mesmo Postgres de teste, e
  // rodar em paralelo faz seed/contexto de uma vazar na outra (RLS + SET LOCAL
  // numa conexão reusada). O project `regras` é puro e rápido — 1 worker não
  // pesa. Banco real = execução sequencial.
  maxWorkers: 1,
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
      /**
       * O timeout de 30 s destas suítes mora no setup file, NÃO em
       * `testTimeout` aqui: o Jest 30 ignora `testTimeout` vindo do arquivo de
       * config, em qualquer posição. Não troque por `testTimeout` — o número
       * volta a não valer, em silêncio, e o flake de migration volta com ele.
       * O porquê inteiro está no próprio arquivo (issue #266).
       */
      setupFilesAfterEnv: ['<rootDir>/test/jest-timeout.setup.ts'],
    },
  ],
};
