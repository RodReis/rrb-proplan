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

/**
 * Tira comentários de bloco e de linha antes de varrer.
 *
 * A regra é sobre o que **executa**. Sem isto, um arquivo que documenta a
 * própria conformidade — *"este arquivo não chama `.installationToken(`"* — é
 * reprovado pela frase que explica por que ele está correto. Aconteceu com o
 * `licensing/infrastructure/github-source.client.ts` (SPEC-039), que existe
 * justamente porque o caminho do convite usa PAT e **não** o token de
 * instalação.
 *
 * Um arch-spec que grita por engano é um arch-spec que alguém desliga — e aí ele
 * para de proteger a regra de verdade. Mesma correção que a
 * `licensing-boundaries.arch.spec.ts` já carrega, e pelo mesmo motivo.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('arquitetura: installationToken só em caminhos de escrita', () => {
  it('nenhum caminho fora da allowlist chama installationToken', () => {
    const offenders = tsFiles(MODULES_DIR)
      .filter((file) =>
        /\.installationToken\s*\(/.test(semComentarios(readFileSync(file, 'utf-8'))),
      )
      .map((file) => file.slice(MODULES_DIR.length + 1).replace(/\\/g, '/'))
      .filter(
        (rel) => !WRITE_ALLOWLIST.some((allowed) => rel.endsWith(allowed.replace(/\\/g, '/'))),
      );

    expect(offenders).toEqual([]);
  });
});
