import { useMemo, useState } from 'react';
import { DocumentSummary } from '../../lib/api';

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
    <ul>
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
  // Pastas próximas da raiz começam abertas; fundo profundo, fechado.
  const [open, setOpen] = useState(depth < 1);
  const isFolder = node.doc === null;
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (isFolder) {
    return (
      <li>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-left text-sm text-text-muted transition-colors duration-150 hover:bg-bg"
          style={pad}
        >
          <span className="shrink-0 text-[10px] text-text-muted/70">
            {open ? '▾' : '▸'}
          </span>
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {open && (
          <ul>
            {sortedChildren(node).map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const doc = node.doc!;
  const isActive = selected === doc.path;
  return (
    <li>
      <button
        onClick={() => onSelect(doc.path)}
        className={
          'group flex w-full items-center justify-between gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors duration-150 ' +
          (isActive ? 'bg-brand/5 text-brand' : 'text-text hover:bg-bg')
        }
        style={pad}
      >
        <span className="truncate">{node.name}</span>
        {doc.isConventional && (
          <span className="shrink-0 rounded-sm bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
            convenção
          </span>
        )}
      </button>
    </li>
  );
}
