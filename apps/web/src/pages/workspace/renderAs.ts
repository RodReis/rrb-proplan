/**
 * Como o leitor deve renderizar um documento de texto.
 *
 * O `kind` do backend (`document-kind.ts`) responde outra pergunta: **o que o
 * sync baixa e persiste**. Lá, `yml`/`yaml`/`txt` são marcados `markdown` porque
 * precisam ser ingeridos (o workflow alimenta a aba Testes) — não porque sejam
 * markdown. O leitor que confiou nesse campo renderizava YAML como markdown, e
 * todo comentário `# …` virava um heading gigante.
 *
 * Daqui em diante o leitor decide pela extensão. Separar os dois papéis no
 * backend (um `renderAs` ao lado do `kind`) seria mais correto, mas mexe em
 * schema e ingestão — item no STATUS.md, não conserto de leitor.
 */
export type TextRender = 'markdown' | 'plain';

const PLAIN_EXT = new Set(['yml', 'yaml', 'txt', 'json', 'toml', 'ini', 'env', 'lock']);

export function renderAs(path: string): TextRender {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  // Sem extensão (LICENSE, Dockerfile, .env) → texto puro: markdown só quando
  // se sabe que é markdown, nunca por omissão.
  if (dot <= 0) return 'plain';
  return PLAIN_EXT.has(base.slice(dot + 1).toLowerCase()) ? 'plain' : 'markdown';
}
