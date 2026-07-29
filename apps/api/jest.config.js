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
       * 30 s, contra os 5 s do default do Jest.
       *
       * O `beforeAll` destes specs roda `applyMigrations()` — um
       * `prisma migrate deploy` que sobe processo, conecta e aplica 40+
       * migrations. Localmente leva ~2 s; no runner do CI, sob carga e
       * disputando o Postgres de serviço com as outras suítes, passa dos 5 s e
       * o hook estoura ANTES de qualquer asserção rodar.
       *
       * O sintoma engana: a suíte inteira falha com "Exceeded timeout of 5000
       * ms for a hook", e a leitura natural é "o RLS quebrou" — quando o que
       * quebrou foi o relógio do setup. Aconteceu no CI do #194 (14 falhas de
       * uma vez no `contracts-rls`), e o histórico do workflow mostra o mesmo
       * padrão intermitente em vários branches antes dele.
       *
       * Não afrouxa asserção nenhuma: teste que passa continua passando na
       * mesma velocidade, e teste que trava de verdade ainda falha — 30 s
       * depois em vez de 5.
       */
      testTimeout: 30_000,
    },
  ],
};
