import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (ADR-015): `installationToken` só pode ser chamado por
 * caminhos de **escrita**. Leitura sempre com `userToken` — installation token
 * vazaria repos que o usuário logado não enxerga. A regra é verificada por
 * varredura estática: qualquer service que a chame precisa estar na allowlist
 * de escrita abaixo, com justificativa.
 */

const MODULES_DIR = join(__dirname, '..');

/** Arquivos de escrita autorizados a chamar installationToken. */
const WRITE_ALLOWLIST = [
  // Bootstrap commita .proplan/STATUS.md (write-back) — prova do autor bot.
  join('insight', 'application', 'bootstrap.service.ts'),
  // A própria definição do método vive aqui.
  join('identity', 'application', 'github-auth.service.ts'),
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('arquitetura: installationToken só em caminhos de escrita', () => {
  it('nenhum caminho fora da allowlist chama installationToken', () => {
    const offenders = tsFiles(MODULES_DIR)
      .filter((file) => /\.installationToken\s*\(/.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(MODULES_DIR.length + 1).replace(/\\/g, '/'))
      .filter(
        (rel) => !WRITE_ALLOWLIST.some((allowed) => rel.endsWith(allowed.replace(/\\/g, '/'))),
      );

    expect(offenders).toEqual([]);
  });
});
