/**
 * 30 s para o project `banco`, contra os 5 s do default do Jest.
 *
 * Por que aqui e não `testTimeout` no `jest.config.js`: o **Jest 30 ignora
 * `testTimeout` vindo do arquivo de config** — na raiz, dentro de `projects[]`
 * ou no objeto espalhado, os três dão no mesmo e o hook estoura com
 * "Exceeded timeout of 5000 ms". Verificado por sonda (`beforeAll` de 7 s) nas
 * três posições. Só a flag `--testTimeout` de linha de comando e este
 * `jest.setTimeout` fazem efeito; o setup file ganha por ficar no config, valer
 * para qualquer invocação (`pnpm test`, IDE, CLI direto) e não duplicar o
 * número em dois lugares que podem divergir. Ver issue #266.
 *
 * O motivo dos 30 s: o `beforeAll` dos specs de integração roda
 * `applyMigrations()` — um `prisma migrate deploy` que sobe processo, conecta e
 * aplica 40+ migrations. Localmente leva ~2 s; no runner do CI, sob carga e
 * disputando o Postgres de serviço com as outras suítes, passa dos 5 s e o hook
 * estoura ANTES de qualquer asserção rodar.
 *
 * O sintoma engana: a suíte inteira falha com "Exceeded timeout of 5000 ms for
 * a hook", e a leitura natural é "o RLS quebrou" — quando o que quebrou foi o
 * relógio do setup. Aconteceu no CI do #194 (14 falhas de uma vez no
 * `contracts-rls`) e de novo no #265 (31 falhas num PR que só mexia num `.tsx`).
 *
 * Não afrouxa asserção nenhuma: teste que passa continua passando na mesma
 * velocidade, e teste que trava de verdade ainda falha — 30 s depois em vez de 5.
 */
jest.setTimeout(30_000);
