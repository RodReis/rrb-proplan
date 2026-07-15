/**
 * Contrato de `docs/CONTEXT.md` (SPEC-015, convenção v2) — PURO, sem banco.
 *
 * Markdown round-trip: o ProPlan escreve, o humano edita à mão, o próximo sync
 * relê. `parseContextMd(serializeContextMd(x)) == x` é provado por teste.
 * Campos ausentes degradam com sinalização (`warnings`), nunca quebram o sync.
 */

export type AssertionStatus = 'vigente' | 'a-revalidar';

export interface ContextAssertion {
  /** O texto da asserção (heading da seção). */
  statement: string;
  /** Paths do repo que a asserção cita (vazio = warning, nunca erro). */
  paths: string[];
  author: string;
  /** YYYY-MM-DD. Vazio = sem data → não revalidável (warning). */
  date: string;
  /** SHA (curto ou cheio) do head no momento da captura. */
  sha: string;
  /** Derivado pelo ProPlan na ingestão — o valor do arquivo é só ponto de partida. */
  status: AssertionStatus;
  /** Texto livre após o bloco de campos ('' se não houver). */
  body: string;
}

export interface ParsedContext {
  assertions: ContextAssertion[];
  /** Sinalizações de degradação (campo ausente, data inválida) — nunca erro. */
  warnings: string[];
}

const HEADER_TITLE = '# Contexto — o que não mexer';
const FIELD_RE = /^- (paths|autor|data|sha|status): ?(.*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Remove o bloco de frontmatter YAML (--- ... ---) do início, se houver. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return md;
  return md.slice(end + 4).replace(/^\r?\n/, '');
}

/**
 * Parseia `docs/CONTEXT.md` em asserções. Tolera edição humana: campo ausente
 * degrada com warning; seção sem nenhum campo ainda vira asserção (só texto).
 */
export function parseContextMd(md: string | null): ParsedContext {
  if (!md || !md.trim()) return { assertions: [], warnings: [] };

  const content = stripFrontmatter(md);
  const warnings: string[] = [];
  const assertions: ContextAssertion[] = [];

  // Divide por seções `## ` (a asserção). O `# Contexto` e texto solto antes
  // da primeira seção são ignorados (estrutura, não conteúdo).
  const sections = content.split(/^## /m).slice(1);

  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const statement = lines[0].trim();
    if (!statement) continue;

    const fields: Record<string, string> = {};
    const bodyLines: string[] = [];
    let inFields = true;
    for (const line of lines.slice(1)) {
      const m = inFields ? FIELD_RE.exec(line.trim()) : null;
      if (m) {
        fields[m[1]] = m[2].trim();
        continue;
      }
      // Primeira linha não-campo e não-vazia encerra o bloco de campos.
      if (inFields && line.trim() === '' && bodyLines.length === 0) continue;
      inFields = false;
      bodyLines.push(line);
    }

    const paths = (fields.paths ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (paths.length === 0)
      warnings.push(`Asserção "${statement}": sem paths citados`);
    if (!fields.autor) warnings.push(`Asserção "${statement}": sem autor`);

    let date = fields.data ?? '';
    if (date && !DATE_RE.test(date)) {
      warnings.push(`Asserção "${statement}": data inválida "${date}"`);
      date = '';
    }
    if (!date) warnings.push(`Asserção "${statement}": sem data — não revalidável`);

    const status: AssertionStatus =
      fields.status === 'a-revalidar' ? 'a-revalidar' : 'vigente';

    assertions.push({
      statement,
      paths,
      author: fields.autor ?? '',
      date,
      sha: fields.sha ?? '',
      status,
      body: bodyLines.join('\n').trim(),
    });
  }

  return { assertions, warnings };
}

/** Serializa as asserções de volta no formato canônico do CONTEXT.md. */
export function serializeContextMd(assertions: ContextAssertion[]): string {
  const sections = assertions.map((a) => {
    const fields = [
      `- paths: ${a.paths.join(', ')}`,
      `- autor: ${a.author}`,
      `- data: ${a.date}`,
      `- sha: ${a.sha}`,
      `- status: ${a.status}`,
    ].join('\n');
    const body = a.body ? `\n\n${a.body}` : '';
    return `## ${a.statement}\n${fields}${body}`;
  });
  return `---\nproplan: v2\n---\n${HEADER_TITLE}\n\n${sections.join('\n\n')}\n`;
}

/**
 * Validade datada (SPEC-015): algum path citado recebeu commit DEPOIS da data
 * da asserção → `a-revalidar`. Rebaixa, nunca apaga. Sem data ou sem commits →
 * mantém `vigente` (degradação sinalizada no parse, não aqui).
 */
export function revalidationStatus(
  assertionDate: string,
  lastPathCommits: (Date | null)[],
): AssertionStatus {
  if (!DATE_RE.test(assertionDate)) return 'vigente';
  // Fim do dia da asserção: commit no mesmo dia da captura não rebaixa.
  const asserted = new Date(`${assertionDate}T23:59:59.999Z`);
  const stale = lastPathCommits.some((d) => d !== null && d > asserted);
  return stale ? 'a-revalidar' : 'vigente';
}
