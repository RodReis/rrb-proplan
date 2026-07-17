import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (SPEC-022, F2): o contexto de tenant (`app.tenant_id`) só
 * pode ser setado num ÚNICO ponto — `PrismaService.withTenant`. Se um service
 * chamasse `set_config('app.tenant_id', ...)` por conta própria, poderia forjar
 * o contexto e ler/escrever outro tenant, furando o RLS. A regra é verificada
 * por varredura estática com allowlist, como o `installation-token-usage`.
 */

const SRC_DIR = join(__dirname, '..');

/** Únicos arquivos que compõem o mecanismo de contexto de tenant. */
const CONTEXT_ALLOWLIST = [
  join('prisma', 'prisma.service.ts'), // define withTenant — o único setter legítimo
  join('prisma', 'tenant-context.ts'), // o AsyncLocalStorage par do withTenant (cita a var na doc)
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.int-spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('arquitetura: app.tenant_id só é setado em withTenant', () => {
  it('nenhum arquivo fora da allowlist seta app.tenant_id', () => {
    // Mira a CHAMADA que seta o contexto (set_config/SET LOCAL de app.tenant_id),
    // não a mera menção da string em comentário — o ALS tenant-context.ts cita a
    // var na doc sem setá-la.
    const setsContext = /set_config\(\s*['"]app\.tenant_id['"]|SET\s+LOCAL\s+app\.tenant_id/i;
    const offenders = tsFiles(SRC_DIR)
      .filter((file) => setsContext.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(SRC_DIR.length + 1).replace(/\\/g, '/'))
      .filter(
        (rel) =>
          !CONTEXT_ALLOWLIST.some((allowed) => rel.endsWith(allowed.replace(/\\/g, '/'))),
      );

    expect(offenders).toEqual([]);
  });
});
