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
  // A própria definição do método vive aqui.
  join('identity', 'application', 'github-auth.service.ts'),
  // Board (SPEC-005): toda escrita de Kanban usa installation token (bot).
  join('board', 'application', 'mutation-applier.service.ts'), // aplica mutações na Issues API
  join('board', 'application', 'projection.service.ts'), // commita .proplan/STATUS.md
  join('board', 'application', 'board-import.service.ts'), // cria issues (import/bootstrap)
  // Fatia 6 (ADR-014): escreve o mapeamento do usuário em .proplan/config.yml.
  join('board', 'application', 'mapping.service.ts'), // commita .proplan/config.yml (bot)
  // Fatia 7, Task 11: promove fallback inferido a docs/ARCHITECTURE.md ou docs/DESIGN.md.
  join('board', 'application', 'tabs.service.ts'), // commita o doc real revisado (bot)
  // Fatia 10 (SPEC-015): captura/revalidação de asserção commita docs/CONTEXT.md.
  join('context', 'application', 'context.service.ts'), // commita docs/CONTEXT.md (bot)
  // Fatia 13.5 (SPEC-018): write-back do handoff commita .proplan/HANDOFF.md.
  join('handoff', 'application', 'handoff-commit.service.ts'), // commita .proplan/HANDOFF.md (bot)
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
