import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { DocKind, DocumentSummary } from '../../lib/api';

/** Nó da árvore: pasta (com filhos) ou arquivo (com o doc). */
interface TreeNode {
  name: string;
  path: string; // caminho acumulado (pasta) ou path do doc (arquivo)
  children: Map<string, TreeNode>;
  doc: DocumentSummary | null; // preenchido só em folha de arquivo
}

function emptyNode(name: string, path: string): TreeNode {
  return { name, path, children: new Map(), doc: null };
}

/** Constrói a árvore de pastas a partir da lista plana de documentos. */
function buildTree(docs: DocumentSummary[]): TreeNode {
  const root = emptyNode('', '');
  for (const doc of docs) {
    const parts = doc.path.split('/');
    let node = root;
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = emptyNode(part, acc);
        node.children.set(part, child);
      }
      if (isLeaf) child.doc = doc;
      node = child;
    });
  }
  return root;
}

/** Ordena: pastas antes de arquivos, ambos alfabéticos. */
function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    const aFolder = a.doc === null;
    const bFolder = b.doc === null;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface Props {
  docs: DocumentSummary[];
  selected: string | null;
  onSelect: (path: string) => void;
}

/** Lista de documentos em árvore de pastas, com pastas expansíveis. */
export function DocTree({ docs, selected, onSelect }: Props) {
  const root = useMemo(() => buildTree(docs), [docs]);
  return (
    <ul className="select-none">
      {sortedChildren(root).map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={0}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

const INDENT = 14; // px por nível — recuo dos filhos

function TreeItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const reduce = useReducedMotion();
  // Pastas próximas da raiz começam abertas; fundo profundo, fechado.
  const [open, setOpen] = useState(depth < 1);
  const isFolder = node.doc === null;
  const padLeft = depth * INDENT + 8;

  if (isFolder) {
    const children = sortedChildren(node);
    return (
      <li>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group relative flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          style={{ paddingLeft: padLeft }}
        >
          <Chevron open={open} />
          <FolderIcon open={open} />
          <span className="truncate font-medium">{node.name}</span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.ul
              initial={reduce ? undefined : { height: 0, opacity: 0 }}
              animate={reduce ? undefined : { height: 'auto', opacity: 1 }}
              exit={reduce ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative overflow-hidden"
            >
              {/* guia de indentação: linha vertical sutil alinhada ao chevron.
                  Um único fade no container (sem stagger por item) — barato e
                  suave mesmo em pasta com muitos filhos (DESIGN.md: compositor). */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-1 w-px bg-border"
                style={{ left: padLeft + 6 }}
              />
              {children.map((child) => (
                <TreeItem
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  selected={selected}
                  onSelect={onSelect}
                />
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </li>
    );
  }

  const doc = node.doc!;
  const isActive = selected === doc.path;
  return (
    <li>
      <button
        onClick={() => onSelect(doc.path)}
        aria-current={isActive ? 'true' : undefined}
        className={
          'group relative flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition-colors duration-150 ' +
          (isActive
            ? 'bg-brand/[0.06] font-medium text-text'
            : 'text-text-muted hover:bg-surface-hover hover:text-text')
        }
        style={{ paddingLeft: padLeft + 16 /* alinha com o nome da pasta (após chevron) */ }}
      >
        {/* barra lateral do item ativo — cresce de cima a baixo (padrão DESIGN.md) */}
        {isActive && (
          <motion.span
            layoutId="doctree-active"
            aria-hidden
            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-brand"
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <FileIcon kind={doc.kind} />
        <span className="truncate">{node.name}</span>
        {doc.isConventional && (
          <span className="ml-auto shrink-0 rounded-[4px] bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
            conv
          </span>
        )}
      </button>
    </li>
  );
}

/* ── Ícones (SVG inline, coerente com o resto do app — sem dep) ────────── */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 text-text-muted/60 transition-transform duration-200 ease-out"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
      fill="none"
      aria-hidden
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 text-text-muted/80"
      fill="none"
      aria-hidden
    >
      {open ? (
        <path
          d="M2.5 6.5A1.5 1.5 0 014 5h3.2l1.4 1.6H16A1.5 1.5 0 0117.5 8v.4H6.2a1.5 1.5 0 00-1.45 1.1L3 15.5V6.5z M6.2 9.9h11.3l-1.6 5.1a1 1 0 01-.95.7H4.2a1 1 0 01-.96-1.28l1.55-4.9a1 1 0 01.96-.72z"
          fill="currentColor"
          fillOpacity="0.9"
        />
      ) : (
        <path
          d="M2.5 6A1.5 1.5 0 014 4.5h3.3l1.4 1.6H16A1.5 1.5 0 0117.5 7.6v6.4A1.5 1.5 0 0116 15.5H4A1.5 1.5 0 012.5 14V6z"
          fill="currentColor"
          fillOpacity="0.9"
        />
      )}
    </svg>
  );
}

/** Cor semântica por tipo de documento (afrouxamento aprovado do "só carbono"
 *  para a árvore — o tipo do arquivo vira sinal visual imediato). */
const KIND_COLOR: Record<DocKind, string> = {
  markdown: 'text-text-muted/70',
  pdf: 'text-error/80',
  image: 'text-success/80',
  html: 'text-warning',
  office: 'text-brand/70',
  binary: 'text-text-muted/50',
};

function FileIcon({ kind }: { kind: DocKind }) {
  const cls = `h-4 w-4 shrink-0 ${KIND_COLOR[kind]}`;

  if (kind === 'image')
    return (
      <svg viewBox="0 0 20 20" className={cls} fill="none" aria-hidden>
        <rect x="3" y="4" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="7.5" cy="8" r="1.2" fill="currentColor" />
        <path d="M4 14l3.5-3.5 2.5 2.5L13 9l3 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );

  if (kind === 'pdf')
    return (
      <svg viewBox="0 0 20 20" className={cls} fill="none" aria-hidden>
        <path d="M5 2.5h6L15.5 7v9.5A1 1 0 0114.5 17.5h-9A1 1 0 014.5 16.5v-13A1 1 0 015.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M11 2.5V7h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <text x="10" y="14.5" textAnchor="middle" fontSize="4.5" fontWeight="700" fill="currentColor">PDF</text>
      </svg>
    );

  if (kind === 'html')
    return (
      <svg viewBox="0 0 20 20" className={cls} fill="none" aria-hidden>
        <rect x="3" y="4" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 9l-2 2 2 2M12 9l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );

  if (kind === 'office')
    return (
      <svg viewBox="0 0 20 20" className={cls} fill="none" aria-hidden>
        <path d="M5 2.5h6L15.5 7v9.5A1 1 0 0114.5 17.5h-9A1 1 0 014.5 16.5v-13A1 1 0 015.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M11 2.5V7h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M7 10.5h6M7 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );

  if (kind === 'binary')
    return (
      <svg viewBox="0 0 20 20" className={cls} fill="none" aria-hidden>
        <path d="M5 2.5h6L15.5 7v9.5A1 1 0 0114.5 17.5h-9A1 1 0 014.5 16.5v-13A1 1 0 015.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M11 2.5V7h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );

  // markdown / texto
  return (
    <svg viewBox="0 0 20 20" className={cls} fill="none" aria-hidden>
      <path d="M5 2.5h6L15.5 7v9.5A1 1 0 0114.5 17.5h-9A1 1 0 014.5 16.5v-13A1 1 0 015.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 2.5V7h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7 10.5h6M7 13h6M7 8h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
