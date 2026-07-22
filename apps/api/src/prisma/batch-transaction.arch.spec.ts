import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (issue #113): nenhum service monta um
 * `$transaction([...])` em LOTE com mais de uma operação de model.
 *
 * O bug que esta regra trava (produção, 2026-07-22): sob `runInTenantContext`
 * — como todo o sync roda — o acesso ao model devolve o delegate do client
 * ESTENDIDO, que embrulha cada operação na sua própria
 * `$transaction([set_config, query])`. Esses PrismaPromise já-construídos não
 * se fundem ao lote externo: o SQL mostra o DELETE numa conexão e o INSERT em
 * outra, com o INSERT commitando ANTES. Quando ele ganha a corrida, colide no
 * unique e o sync morre com "Unique constraint failed" — o usuário vê
 * "Sincronização falhou" no painel de Atividade.
 *
 * O lote com UMA operação é seguro (o set_config injetado vale para ela). O
 * problema é a promessa de atomicidade entre DUAS ou mais, que a forma não
 * cumpre. Para isso existe `$transaction(async (tx) => …)` — uma conexão, na
 * ordem escrita.
 *
 * Por que um teste de TEXTO e não de comportamento: o defeito é intermitente
 * (depende de qual conexão o pool entrega), então um teste de comportamento
 * passa às vezes — foi exatamente assim que ele sobreviveu desde o PR #86.
 * A varredura estática não tem esse problema.
 */

const SRC = join(__dirname, '..', 'modules');

/** Arquivos de service (exclui spec) sob src/modules. */
function serviceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.includes('.spec.'))
        out.push(full);
    }
  };
  walk(SRC);
  return out;
}

describe('arquitetura: $transaction em lote não promete atomicidade sob contexto', () => {
  it('nenhum service monta um lote com 2+ operações de model', () => {
    const offenders: string[] = [];

    for (const file of serviceFiles()) {
      const src = readFileSync(file, 'utf-8');
      // Casa `$transaction([` … `])` — o corpo do lote, com quebras de linha.
      const batches = src.matchAll(/\$transaction\(\[([\s\S]*?)\]\s*\)/g);
      for (const match of batches) {
        const body = match[1];
        // Conta operações de model: `this.prisma.<model>.<op>(` ou `tx.<model>.<op>(`.
        const ops = body.match(/\b(?:this\.prisma|tx)\.\w+\.\w+\(/g) ?? [];
        if (ops.length > 1) {
          const rel = file.slice(file.indexOf('modules'));
          offenders.push(`${rel.replace(/\\/g, '/')} → lote com ${ops.length} operações`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
