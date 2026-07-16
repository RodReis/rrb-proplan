import { describe, expect, it } from 'vitest';
import { renderAs } from './renderAs';

describe('renderAs', () => {
  it('renderiza markdown como markdown', () => {
    expect(renderAs('docs/DESIGN.md')).toBe('markdown');
    expect(renderAs('README.md')).toBe('markdown');
    expect(renderAs('CLAUDE.markdown')).toBe('markdown');
  });

  // O bug que originou este módulo: o comentário `# …` do YAML virava heading
  // gigante porque o backend marca yml como `kind: markdown` (para ingerir).
  it('renderiza YAML como texto puro', () => {
    expect(renderAs('.github/workflows/ci.yml')).toBe('plain');
    expect(renderAs('.proplan/config.yaml')).toBe('plain');
  });

  it('renderiza os demais formatos de dado como texto puro', () => {
    expect(renderAs('package.json')).toBe('plain');
    expect(renderAs('notas.txt')).toBe('plain');
    expect(renderAs('Cargo.toml')).toBe('plain');
    expect(renderAs('pnpm-lock.lock')).toBe('plain');
  });

  // Markdown só quando se sabe que é markdown — nunca por omissão.
  it('trata arquivo sem extensão como texto puro', () => {
    expect(renderAs('LICENSE')).toBe('plain');
    expect(renderAs('Dockerfile')).toBe('plain');
    expect(renderAs('docs/Makefile')).toBe('plain');
  });

  it('ignora caixa da extensão', () => {
    expect(renderAs('CI.YML')).toBe('plain');
    expect(renderAs('README.MD')).toBe('markdown');
  });

  // Dotfile: o ponto inicial não é separador de extensão.
  it('não confunde dotfile com extensão', () => {
    expect(renderAs('.env')).toBe('plain');
    expect(renderAs('.gitignore')).toBe('plain');
  });

  it('usa a última extensão em nome com vários pontos', () => {
    expect(renderAs('docs/spec.draft.md')).toBe('markdown');
    expect(renderAs('config.local.yml')).toBe('plain');
  });
});
