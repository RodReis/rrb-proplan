/**
 * Mock de `$transaction` que suporta as DUAS formas do Prisma (issue #113):
 * lote em array e callback interativo.
 *
 * Por que existe: os serviços de replace-all (`resolution.rebuild`,
 * `canonical.rebuild`, `context.rebuild`, `link.rebuildLinks`,
 * `board.syncIssues`, `writeInferredEdges`) usam a forma **interativa**. O lote
 * em array quebra sob `runInTenantContext` — cada operação chega já embrulhada
 * na própria transação pelo client estendido, então DELETE e INSERT saem em
 * conexões diferentes e fora de ordem; quando o INSERT commita primeiro, colide
 * no unique e derruba o sync ("Unique constraint failed").
 *
 * Um mock que só entende array deixa o teste passar com um call site que
 * quebraria em produção — foi o que mascarou o bug até a #113. Este helper
 * mantém os fakes honestos aos dois contratos.
 */
export function transactionMock(client: () => unknown) {
  return jest
    .fn()
    .mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? // Interativa: o callback recebe o `tx`. No fake, o próprio client
          // responde por ele — mesmos delegates, mesmas asserções.
          (arg as (tx: unknown) => Promise<unknown>)(client())
        : Promise.all(arg as Promise<unknown>[]),
    );
}
