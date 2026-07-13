import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (ADR-010 / ADR-011): a projeção do board mora em
 * `.proplan/`, NUNCA em `docs/`. Se um card arrastado gerasse commit em
 * `docs/`, o `lastDocsCommitAt` viraria "agora" e o alerta de documentação
 * defasada morreria em silêncio — o produto mentiria por construção. É a
 * razão de a projeção viver fora de `docs/`.
 */

const BOARD_DIR = join(__dirname);

describe('arquitetura ADR-010: projeção fora de docs/', () => {
  it('o path da projeção é .proplan/STATUS.md, não docs/', () => {
    const src = readFileSync(
      join(BOARD_DIR, 'application', 'projection.service.ts'),
      'utf-8',
    );
    const match = /PROJECTION_PATH\s*=\s*'([^']+)'/.exec(src);
    expect(match).not.toBeNull();
    const path = match![1];
    expect(path).toBe('.proplan/STATUS.md');
    expect(path.startsWith('docs/')).toBe(false);
  });

  it('a mensagem de commit da projeção usa o prefixo proplan:', () => {
    const src = readFileSync(
      join(BOARD_DIR, 'domain', 'projection.ts'),
      'utf-8',
    );
    expect(src).toContain("PROJECTION_COMMIT_MESSAGE");
    expect(src).toMatch(/proplan: atualiza STATUS\.md/);
  });

  it('o cabeçalho de artefato gerado está presente na projeção', () => {
    const src = readFileSync(
      join(BOARD_DIR, 'domain', 'projection.ts'),
      'utf-8',
    );
    expect(src).toContain('gerado pelo ProPlan a partir das Issues');
  });
});
