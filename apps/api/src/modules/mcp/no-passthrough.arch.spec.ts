import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (SPEC-016, critério §4 + ADR-001/ADR-017): o MCP é
 * adaptador FINO e NUNCA faz pass-through de fato do GitHub.
 *
 * - Não importa clients/entidades internas de outro módulo (GithubIssuesClient,
 *   repositórios crus) — consome só interfaces públicas (services exportados).
 * - Não lê `prisma.issue` (o board é a interface; o GitHub MCP serve a issue
 *   viva). O único acesso a prisma permitido é `project.findFirst` para resolver
 *   owner/repo → dono (sem-auth no MVP, decisão 1 do PI).
 * - Não reproduz corpo de issue — só referencia número+URL.
 */

const MCP_DIR = __dirname;

function allTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...allTsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('arquitetura SPEC-016: MCP não faz pass-through (ADR-017)', () => {
  const files = allTsFiles(MCP_DIR);
  const sources = files.map((f) => ({ f, src: readFileSync(f, 'utf-8') }));

  it('nenhum arquivo importa client/infra ou entidade interna de outro módulo', () => {
    for (const { f, src } of sources) {
      if (/from ['"].*\/infrastructure\//.test(src)) {
        expect(`${f}: importa infrastructure/ de outro módulo`).toBe('proibido');
      }
      if (/GithubIssuesClient/.test(src)) {
        expect(`${f}: usa GithubIssuesClient (pass-through)`).toBe('proibido');
      }
    }
  });

  it('não lê prisma.issue (o board é a interface; a issue viva é do GitHub MCP)', () => {
    for (const { f, src } of sources) {
      if (/prisma\.issue\b/.test(src)) {
        expect(`${f}: lê prisma.issue diretamente`).toBe('proibido');
      }
    }
  });

  it('o único acesso a prisma é project.findFirst (resolver owner/repo)', () => {
    for (const { f, src } of sources) {
      const prismaCalls = src.match(/prisma\.\w+\.\w+/g) ?? [];
      for (const call of prismaCalls) {
        expect(call).toBe('prisma.project.findFirst');
      }
    }
  });
});
