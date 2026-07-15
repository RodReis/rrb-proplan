/**
 * Handoff exportável (SPEC-018, Fatia 13.5) — domínio PURO, sem IA, sem banco.
 *
 * Congela o modelo canônico (Fatia 9) num pacote portátil: para cada bloco,
 * `{ valor | recusa, proveniência, confiança, a conta }`. Bloco abaixo do
 * limiar RECUSA ("não sei — ausente/defasado") em vez de chutar — a ausência
 * honesta é o produto (§Objetivo). Nada é recalculado aqui: o número vem do
 * canônico, o texto do que já está persistido (ADR-001/ADR-002).
 *
 * Duas superfícies, uma montagem: `assembleHandoff` é o mesmo domínio que o
 * `get_handoff_context` do MCP (Fatia 11, SPEC-016) vai herdar (decisão 5 do PI).
 *
 * `renderHandoffMarkdown` é serialização determinística: mesmo input → bytes
 * idênticos (ordenação estável), o que torna o diff entre dois instantâneos um
 * subproduto de graça quando o arquivo é `.proplan/HANDOFF.md` versionado.
 */

import { ConfidenceSignals } from '../../canonical/domain/confidence';
import {
  CanonicalModel,
  FieldView,
  ProvenanceClass,
} from '../../canonical/domain/canonical-model';

/** Referência a uma issue — número + URL + título datado, NUNCA o corpo/estado
 *  (ADR-017; decisão 3 do PI). `title` é rótulo, não o fato vivo que o GitHub
 *  serve; entra com o caveat de validade impresso no bloco. */
export interface IssueRef {
  number: number;
  url: string;
  title: string;
  /** YYYY-MM-DD — quando este rótulo foi capturado (o estado vivo está no GitHub). */
  capturedAt: string;
}

export interface BlockPresent {
  refused: false;
  /** Valor legível já serializado do campo canônico. */
  value: string;
  provenance: ProvenanceClass;
  /** path/paths + sha + date do campo — vira o rodapé de proveniência. */
  provenanceRef: unknown;
  confidence: number;
  math: ConfidenceSignals;
}

export interface BlockRefused {
  refused: true;
  /** "não sei — ausente/defasado". */
  reason: string;
  /** O link do que falta preencher/confirmar. */
  missing: unknown;
  confidence: number;
  math: ConfidenceSignals;
}

export type BlockBody = BlockPresent | BlockRefused;

export interface HandoffBlock {
  /** Chave estável (ordena o markdown determinístico). */
  key: string;
  title: string;
  body: BlockBody;
  /** Só o bloco de backlog carrega refs de issue (referência, sem corpo). */
  refs?: IssueRef[];
}

/** Mensagem de commit do write-back — prefixo proplan: (artefato do ProPlan,
 *  não conteúdo humano; ADR-014). */
export const HANDOFF_COMMIT_MESSAGE = 'proplan: atualiza HANDOFF.md';

export interface Handoff {
  /** Cabeçalho de validade — impede o handoff de mentir por frescor (§4). */
  header: {
    generatedAt: string;
    docsScopeHash: string;
    notice: string;
  };
  blocks: HandoffBlock[];
}

/** Ordem de retomada dos blocos canônicos (MVP2 §6). Entidades fora desta lista
 *  entram depois, em ordem alfabética estável — nunca somem. */
const BLOCK_ORDER: { entity: string; title: string }[] = [
  { entity: 'project', title: 'Projeto + objetivo' },
  { entity: 'architecture', title: 'Arquitetura + módulos' },
  { entity: 'decisions', title: 'Decisões / ADRs' },
  { entity: 'design', title: 'Design' },
  { entity: 'testing', title: 'Testes' },
  { entity: 'deploy', title: 'Deploy' },
  { entity: 'skills', title: 'Skills & Agentes' },
  { entity: 'constraints', title: 'Restrições (o que não mexer)' },
];

export interface AssembleInput {
  model: CanonicalModel;
  generatedAt: string;
  docsScopeHash: string;
  /** Próximo card em "A Fazer" (board), ou null se a coluna está vazia / board
   *  em modo degradado. Referência pura, zero IA (nota técnica da spec). */
  nextCard: { number: number; url: string; title: string } | null;
  /** Backlog referenciado por issue — número+URL+título datado, sem corpo. */
  backlog: IssueRef[];
}

/**
 * Projeção de leitura pura: monta a estrutura de handoff a partir do modelo
 * canônico + board. Não muta a entrada. Blocos que dependem de fatias ainda não
 * entregues (constraints=Fatia 10, próxima ação rica=Fatia 11) recusam
 * honestamente via o próprio canônico — sem caso especial (decisão 1 do PI).
 */
export function assembleHandoff(input: AssembleInput): Handoff {
  const blocks: HandoffBlock[] = [];

  // 1. Blocos canônicos, na ordem de retomada. Uma entidade pode ter vários
  //    campos (ex.: constraints tem um por asserção) — cada campo é um bloco.
  const seenEntities = new Set<string>();
  for (const { entity, title } of BLOCK_ORDER) {
    seenEntities.add(entity);
    blocks.push(...blocksForEntity(entity, title, input.model));
  }
  // Entidades canônicas fora da ordem fixa (nunca omitidas), alfabéticas.
  for (const entity of Object.keys(input.model.entities).sort()) {
    if (seenEntities.has(entity)) continue;
    blocks.push(...blocksForEntity(entity, capitalize(entity), input.model));
  }

  // 2. Backlog — referência às issues, datada, sem corpo (ADR-017).
  blocks.push(backlogBlock(input.backlog));

  // 3. Próxima ação — derivada do board, referência pura, zero IA. Slot honesto
  //    enquanto a Fatia 11 não deriva a recomendação rica (nota técnica).
  blocks.push(nextActionBlock(input.nextCard));

  return {
    header: {
      generatedAt: input.generatedAt,
      docsScopeHash: input.docsScopeHash,
      notice:
        'este é um instantâneo; o estado vivo está no GitHub — verifique na fonte antes de agir',
    },
    blocks,
  };
}

function blocksForEntity(
  entity: string,
  title: string,
  model: CanonicalModel,
): HandoffBlock[] {
  const ent = model.entities[entity];
  if (!ent) {
    // Entidade ausente do canônico → bloco de recusa honesto, nunca omitido.
    return [
      {
        key: entity,
        title,
        body: {
          refused: true,
          reason: 'não sei — ausente/defasado',
          missing: { entity },
          confidence: 0,
          math: zeroMath(),
        },
      },
    ];
  }
  // Campos ordenados por chave estável → markdown determinístico.
  return Object.keys(ent.fields)
    .sort()
    .map((field) => ({
      key: `${entity}.${field}`,
      title: fieldTitle(title, entity, field),
      body: fieldToBody(ent.fields[field]),
    }));
}

/** `presence` é o campo único da maioria das entidades → o título é a entidade;
 *  entidades multi-campo (constraints) qualificam com o nome do campo. */
function fieldTitle(entityTitle: string, entity: string, field: string): string {
  if (field === 'presence') return entityTitle;
  return `${entityTitle} · ${field}`;
}

function fieldToBody(view: FieldView): BlockBody {
  if (view.refused) {
    return {
      refused: true,
      reason: 'não sei — ausente/defasado',
      missing: view.missing,
      confidence: view.confidence,
      math: view.math,
    };
  }
  return {
    refused: false,
    value: stringifyValue(view.value),
    provenance: view.provenance,
    provenanceRef: view.provenanceRef,
    confidence: view.confidence,
    math: view.math,
  };
}

function backlogBlock(backlog: IssueRef[]): HandoffBlock {
  if (backlog.length === 0) {
    return {
      key: 'zz-backlog',
      title: 'Backlog + último estado',
      body: {
        refused: true,
        reason: 'não sei — ausente/defasado',
        missing: { note: 'sem issues no cache do board (ou modo degradado)' },
        confidence: 0,
        math: zeroMath(),
      },
    };
  }
  return {
    key: 'zz-backlog',
    title: 'Backlog + último estado',
    body: {
      refused: false,
      value:
        'referência às issues abaixo — estado no momento da exportação; ' +
        'verifique o estado vivo no GitHub (ADR-017)',
      provenance: 'fato',
      provenanceRef: { source: 'github-issues' },
      confidence: 1,
      math: zeroMath(),
    },
    refs: backlog,
  };
}

function nextActionBlock(
  card: { number: number; url: string; title: string } | null,
): HandoffBlock {
  if (!card) {
    return {
      key: 'zz-next-action',
      title: 'Próxima ação recomendada',
      body: {
        refused: true,
        reason: 'não sei — ausente/defasado',
        missing: { note: 'coluna "A Fazer" vazia ou board indisponível' },
        confidence: 0,
        math: zeroMath(),
      },
    };
  }
  return {
    key: 'zz-next-action',
    title: 'Próxima ação recomendada',
    body: {
      refused: false,
      value: `próximo card em A Fazer: #${card.number} — ${card.title} (${card.url})`,
      provenance: 'fato',
      provenanceRef: { source: 'board:todo' },
      confidence: 1,
      math: zeroMath(),
    },
  };
}

/** Serializa a estrutura em markdown legível por humano e parseável por agente.
 *  Bloco recusado vira seção explícita, NUNCA omitido. Cada bloco imprime
 *  `classe · proveniência · data · confiança (a conta)`; sha vai ao rodapé
 *  (decisão 4 do PI: leve no corpo, sha no rodapé). */
export function renderHandoffMarkdown(h: Handoff): string {
  const lines: string[] = [];
  lines.push('# Handoff — instantâneo de contexto');
  lines.push('');
  lines.push(
    `> gerado em ${h.header.generatedAt} · docsScopeHash \`${h.header.docsScopeHash}\``,
  );
  lines.push(`> ${h.header.notice}`);
  lines.push('');

  const footnotes: string[] = [];
  for (const block of h.blocks) {
    lines.push(`## ${block.title}`);
    if (block.body.refused) {
      lines.push('');
      lines.push(
        `**não sei — ausente/defasado** · falta: ${describeMissing(block.body.missing)}`,
      );
      lines.push(`confiança ${fmtPct(block.body.confidence)} ${fmtMath(block.body.math)}`);
    } else {
      lines.push('');
      lines.push(block.body.value);
      if (block.refs) {
        for (const r of block.refs) {
          lines.push(
            `- [#${r.number}](${r.url}) — ${r.title} _(rótulo em ${r.capturedAt}; estado vivo no GitHub)_`,
          );
        }
      }
      const prov = describeProvenance(block.body.provenanceRef);
      lines.push('');
      lines.push(
        `_${block.body.provenance}${prov ? ` · ${prov}` : ''} · ` +
          `confiança ${fmtPct(block.body.confidence)} ${fmtMath(block.body.math)}_`,
      );
      const sha = shaOf(block.body.provenanceRef);
      if (sha) footnotes.push(`- \`${block.key}\` → sha \`${sha}\``);
    }
    lines.push('');
  }

  if (footnotes.length > 0) {
    lines.push('---');
    lines.push('### Proveniência (auditoria)');
    lines.push('');
    lines.push(...footnotes);
    lines.push('');
  }

  return lines.join('\n');
}

// ---- helpers de serialização (puros, determinísticos) ----

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '_(vazio)_';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'statement' in value) {
    // constraints: { statement, paths } — o statement é o texto do fosso.
    return String((value as { statement: unknown }).statement);
  }
  return '`' + JSON.stringify(value) + '`';
}

function describeProvenance(ref: unknown): string {
  if (!ref || typeof ref !== 'object') return '';
  const r = ref as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.path === 'string') parts.push(r.path);
  else if (Array.isArray(r.paths) && r.paths.length) parts.push(r.paths.join(', '));
  if (typeof r.status === 'string') parts.push(`marca: ${r.status}`);
  if (typeof r.date === 'string' && r.date) parts.push(r.date);
  return parts.join(' · ');
}

function shaOf(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const sha = (ref as Record<string, unknown>).sha;
  return typeof sha === 'string' && sha ? sha : null;
}

function describeMissing(missing: unknown): string {
  if (!missing) return 'confirmação da fonte';
  if (typeof missing === 'string') return missing;
  if (typeof missing === 'object') {
    const m = missing as Record<string, unknown>;
    if (typeof m.note === 'string') return m.note;
    if (typeof m.path === 'string') return m.path;
    if (Array.isArray(m.paths) && m.paths.length) return m.paths.join(', ');
    if (typeof m.entity === 'string') return `documento de ${m.entity}`;
  }
  return '`' + JSON.stringify(missing) + '`';
}

function fmtPct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** A conta exibida: staleness + cobertura sempre; contradição/drift só quando
 *  não-zero (slots de peso zero — transparência sem poluir). */
function fmtMath(m: ConfidenceSignals): string {
  const parts = [`staleness ${m.stalenessDays}d`, `cobertura ${m.cobertura}`];
  if (m.contradicao) parts.push(`contradição ${m.contradicao}`);
  if (m.drift) parts.push(`drift ${m.drift}`);
  return `(${parts.join(' · ')})`;
}

function zeroMath(): ConfidenceSignals {
  return { stalenessDays: 0, cobertura: 0, contradicao: 0, drift: 0 };
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
