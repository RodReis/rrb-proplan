import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint do monorepo (issue #190).
 *
 * O `CLAUDE.md` exige *"`dev`, `test`, `lint` verdes é o piso"*, e até esta
 * entrega o `lint` não existia — nem script, nem config. Como o merge é do
 * próprio Code com o CI verde, o CI é a única trava antes da `main`.
 *
 * ## O recorte, e por que ele é este
 *
 * **Config única na raiz, não uma por app.** As três bases são TypeScript com
 * as mesmas armadilhas; três configs divergiriam com o tempo e ninguém notaria.
 *
 * **Sem `projectService`/type-aware.** As regras que exigem informação de tipo
 * (`no-floating-promises`, `no-misused-promises`) são as mais valiosas do
 * conjunto — e também as que fariam o lint levar minutos e repetir o trabalho
 * que o `pnpm build` já faz no step anterior. O build cobre tipo; o lint cobre
 * o que o compilador aceita mas ninguém quer.
 *
 * **Regras que restam = as que o `tsc` NÃO pega.** Não há valor em duplicar o
 * compilador; há valor em barrar `any` explícito, variável não usada e `case`
 * que vaza para o próximo.
 */
export default tseslint.config(
  {
    // Artefato, dependência e dado gerado: lintar `dist/` reportaria erro em
    // código que ninguém escreveu.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'graphify-out/**',
      'reports/.raw/**',
      // Cliente gerado pelo Prisma a cada `prisma:generate`.
      'apps/api/generated/**',
      // Protótipos de tela (DESIGN.md): HTML/JS solto que roda no navegador e
      // não entra no bundle. Lintá-los mediria a qualidade de um rascunho.
      'docs/design/**',
      // Ferramenta local do dev (HUD do war-room), fora do produto — foi
      // desversionada em #184 e não é código do ProPlan.
      '.claude/**',
      '.codex/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      /**
       * `any` explícito é `warn`, não `error`.
       *
       * A base tem casos legítimos — o cast do `$extends` no `PrismaService`
       * existe para não carregar o tipo gigante do Prisma no AsyncLocalStorage,
       * e está comentado lá. Transformar em erro obrigaria `eslint-disable`
       * espalhado, que é ruído sem ganho. Como `warn`, aparece na saída e não
       * barra o merge.
       */
      '@typescript-eslint/no-explicit-any': 'warn',

      /**
       * Variável não usada é ERRO, com escape por `_`.
       *
       * É a regra que mais pega coisa real: import que sobrou de uma
       * refatoração, parâmetro que deixou de ser lido. O prefixo `_` é a forma
       * de dizer "sei que não uso" — usado nos testes desta base (`_caso`,
       * `_conteudo`) desde antes desta config existir.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      /**
       * `catch {}` vazio passa por `no-empty` e engole o erro em silêncio — o
       * modo de falhar que esta base combate em vários lugares. Mas bloco vazio
       * com comentário dentro é decisão explícita e continua permitido.
       */
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  {
    files: [
      '**/*.spec.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.int-spec.ts',
      'test/**',
      // Dobras que vivem em `src/` sem sufixo de teste (`fake-recorder.ts`).
      // Elas replicam o comportamento observável de uma dependência; tipar a
      // assinatura inteira do original custaria mais linha do que a dobra tem,
      // e não tornaria o teste mais verdadeiro.
      '**/fake-*.ts',
    ],
    rules: {
      // `any` é rotina em dobra de dependência, e o cast para o tipo real do
      // Prisma custaria mais linha do que o teste tem.
      '@typescript-eslint/no-explicit-any': 'off',

      // `Function[]` para lista de CLASSES de controller: os arch-specs varrem
      // `readonly Function[]` porque é o que um construtor é. A alternativa
      // (`new (...args: never[]) => unknown`) diz o mesmo com mais ruído.
      '@typescript-eslint/no-unsafe-function-type': 'off',

      // `require()` para RE-importar um módulo depois de `jest.resetModules()`
      // — o teste de cookie precisa reavaliar o módulo com outro `NODE_ENV`, e
      // `import` é içado, então não serve.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    /**
     * Regras dos hooks, só no web.
     *
     * **O código já as esperava**: `theme.tsx` e `OperationSteps.tsx` tinham
     * `eslint-disable-next-line react-hooks/exhaustive-deps` desde antes desta
     * config existir — disables apontando para um plugin que ninguém havia
     * instalado. O ESLint reporta isso como *"regra não encontrada"*, que é a
     * forma de dizer que a intenção estava no código e a verificação não.
     *
     * `rules-of-hooks` é ERRO (hook em condicional quebra em runtime, não em
     * tipo); `exhaustive-deps` é AVISO, porque dep faltando às vezes é
     * deliberado — e os dois casos desta base já explicam o porquê no comentário
     * ao lado do disable.
     */
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // Config de ferramenta em CommonJS: `module.exports` é a forma do formato.
    files: ['**/*.config.js', '**/*.cjs'],
    languageOptions: {
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },

  {
    // Scripts de build/manutenção rodam em Node puro, sem os globals do DOM.
    // O seed de referência (`apps/api/prisma/*.mjs`) entra aqui pelo mesmo
    // motivo: é JS puro rodado pelo `node` do deploy, sem passo de build.
    files: ['scripts/**/*.mjs', 'apps/api/prisma/**/*.mjs', '**/*.config.{mjs,ts}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', __dirname: 'readonly' },
    },
  },
);
