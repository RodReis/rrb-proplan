import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (ADR-010 / ADR-014): o write-back do handoff mora em
 * `.proplan/HANDOFF.md`, NUNCA em `docs/`. Escrever em `docs/` empurraria o
 * `lastDocsCommitAt` para "agora" e mataria em silêncio o alerta de documentação
 * defasada — o produto mentiria por construção. Mesmo guarda da projeção do board.
 */

const HANDOFF_DIR = __dirname;

describe('arquitetura ADR-010: handoff fora de docs/', () => {
  it('o path do write-back é .proplan/HANDOFF.md, não docs/', () => {
    const src = readFileSync(
      join(HANDOFF_DIR, 'application', 'handoff-commit.service.ts'),
      'utf-8',
    );
    const match = /HANDOFF_PATH\s*=\s*'([^']+)'/.exec(src);
    expect(match).not.toBeNull();
    const path = match![1];
    expect(path).toBe('.proplan/HANDOFF.md');
    expect(path.startsWith('docs/')).toBe(false);
  });

  it('a mensagem de commit usa o prefixo proplan:', () => {
    const src = readFileSync(join(HANDOFF_DIR, 'domain', 'handoff.ts'), 'utf-8');
    expect(src).toContain('HANDOFF_COMMIT_MESSAGE');
    expect(src).toMatch(/proplan: atualiza HANDOFF\.md/);
  });
});
