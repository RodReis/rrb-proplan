import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MiniMap,
  Node,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api, DocGraph, GraphNode } from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DocViewerPanel } from './DocViewerPanel';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  projectId: string;
  syncNonce: number;
}

const KIND_COLOR: Record<string, string> = {
  readme: '#12B76A', // success
  claude: '#6172F3', // azul info
  doc: '#1D2939', // carbono (brand)
};

// Referências estáveis (fora do componente) — evitam re-render do ReactFlow.
const FIT_OPTS = { padding: 0.2, maxZoom: 1 };
const PRO_OPTS = { hideAttribution: true };

// Estilos pré-computados com referência CONSTANTE por (kind, dim).
// Identidade nova por render re-renderizava o card sob o cursor
// (loop mouseenter/leave = piscar) — referência fixa mata o ciclo.
const NODE_STYLES: Record<
  string,
  { normal: React.CSSProperties; dim: React.CSSProperties }
> = (() => {
  const base: React.CSSProperties = {
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    padding: '8px 12px',
    transition: 'opacity 150ms',
  };
  const solid = (bg: string) => ({
    normal: { ...base, background: bg, color: '#fff', border: 'none', opacity: 1 },
    dim: { ...base, background: bg, color: '#fff', border: 'none', opacity: 0.35 },
  });
  const ghost = (opacity: number): React.CSSProperties => ({
    ...base,
    background: '#FEF3F2',
    border: '1px dashed #F04438',
    color: '#B42318',
    opacity,
  });
  return {
    readme: solid(KIND_COLOR.readme),
    claude: solid(KIND_COLOR.claude),
    doc: solid(KIND_COLOR.doc),
    ghost: { normal: ghost(1), dim: ghost(0.35) },
  };
})();

const EDGE_STYLES = {
  normal: { stroke: '#D0D5DD', opacity: 1, transition: 'opacity 150ms' },
  normalDim: { stroke: '#D0D5DD', opacity: 0.25, transition: 'opacity 150ms' },
  broken: {
    stroke: '#F04438',
    strokeDasharray: '4 4',
    opacity: 1,
    transition: 'opacity 150ms',
  },
  brokenDim: {
    stroke: '#F04438',
    strokeDasharray: '4 4',
    opacity: 0.25,
    transition: 'opacity 150ms',
  },
  inferred: {
    stroke: 'var(--color-warning)',
    strokeWidth: 1.5,
    strokeDasharray: '5 3',
    opacity: 1,
    transition: 'opacity 150ms',
  },
  inferredDim: {
    stroke: 'var(--color-warning)',
    strokeWidth: 1.5,
    strokeDasharray: '5 3',
    opacity: 0.25,
    transition: 'opacity 150ms',
  },
} as const;

interface EdgeMeta {
  kind: 'explicit' | 'inferred';
  reason: string | null;
  sourcePath: string;
  targetPath: string;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: string; // readme | claude | doc | ghost
  path: string | null; // null para nós-fantasma (quebrados)
}

interface SimLink {
  source: string;
  target: string;
  broken: boolean;
  kind: 'explicit' | 'inferred';
  reason: string | null;
  /** path de origem/destino — necessários para api.suppressEdge (que opera por path, não docId). */
  sourcePath: string;
  targetPath: string;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; graph: DocGraph };

export function GraphTab({ projectId, syncNonce }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    api
      .graph(projectId)
      .then((graph) => setState({ status: 'ready', graph }))
      .catch((err) => setState({ status: 'error', message: String(err) }));
  }, [projectId, syncNonce]);

  if (state.status === 'loading')
    return <div className="m-8 h-64 animate-pulse rounded-md bg-border/50" />;
  if (state.status === 'error')
    return (
      <div className="m-8 rounded-md border border-error/30 bg-error/5 p-4 text-sm text-error">
        Falha ao carregar o grafo: {state.message}
      </div>
    );
  if (state.graph.nodes.length === 0)
    return (
      <p className="p-8 text-sm text-text-muted">
        Nenhum documento para exibir no grafo. Sincronize o projeto.
      </p>
    );

  return (
    <ReactFlowProvider>
      {/* key remonta o canvas quando os dados mudam — nunca trocar os nós
          de um canvas vivo por objetos novos (perderia as medições). */}
      <GraphCanvas
        key={`${projectId}:${syncNonce}`}
        projectId={projectId}
        graph={state.graph}
      />
    </ReactFlowProvider>
  );
}

function GraphCanvas({
  projectId,
  graph,
}: {
  projectId: string;
  graph: DocGraph;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [showInferred, setShowInferred] = useState(true);
  const [edgeTooltip, setEdgeTooltip] = useState<{
    id: string;
    reason: string | null;
    sourcePath: string;
    targetPath: string;
    x: number;
    y: number;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{
    id: string;
    sourcePath: string;
    targetPath: string;
  } | null>(null);

  const { simNodes, simLinks, neighbors } = useMemo(
    () => buildGraph(graph),
    [graph],
  );

  // Metadados por id para recomputar estilos sem recriar nós.
  const metaById = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes],
  );

  // Layout de força: roda UMA vez; posições ficam estáticas.
  const initialNodes = useMemo(() => {
    const nodes = simNodes.map((n) => ({ ...n }));
    const links = simLinks.map((l) => ({ ...l }));
    const sim = forceSimulation(nodes)
      .force('charge', forceManyBody().strength(-500))
      .force(
        'link',
        forceLink(links)
          .id((d: SimulationNodeDatum & { id?: string }) => d.id!)
          .distance(120),
      )
      .force('collide', forceCollide(90))
      .force('x', forceX(0).strength(0.05))
      .force('y', forceY(0).strength(0.05))
      .stop();
    for (let i = 0; i < 400; i++) sim.tick();

    return nodes.map<Node>((n) => ({
      id: n.id,
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      data: { label: n.label },
      style: NODE_STYLES[n.kind]?.normal ?? NODE_STYLES.doc.normal,
      type: 'default',
      draggable: false,
      connectable: false,
    }));
  }, [simNodes, simLinks]);

  const initialEdges = useMemo(
    () =>
      simLinks.map<Edge<EdgeMeta>>((l, i) => ({
        id: `e${i}`,
        source: l.source,
        target: l.target,
        animated: false,
        style: l.broken
          ? EDGE_STYLES.broken
          : l.kind === 'inferred'
            ? EDGE_STYLES.inferred
            : EDGE_STYLES.normal,
        data: {
          kind: l.kind,
          reason: l.reason,
          sourcePath: l.sourcePath,
          targetPath: l.targetPath,
        },
      })),
    [simLinks],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Hover: atualiza SÓ o style preservando os nós existentes (spread mantém
  // width/height medidos). Substituir por objetos novos zerava as medições e
  // o ReactFlow escondia tudo (visibility:hidden) até re-medir — o "sumiço".
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const meta = metaById.get(n.id);
        const kind = meta && meta.kind in NODE_STYLES ? meta.kind : 'doc';
        const dim =
          hovered !== null &&
          hovered !== n.id &&
          !neighbors.get(hovered)?.has(n.id);
        const style = dim ? NODE_STYLES[kind].dim : NODE_STYLES[kind].normal;
        return n.style === style ? n : { ...n, style };
      }),
    );
    setEdges((prev) =>
      prev.map((e) => {
        const broken = e.style === EDGE_STYLES.broken || e.style === EDGE_STYLES.brokenDim;
        const inferred = e.style === EDGE_STYLES.inferred || e.style === EDGE_STYLES.inferredDim;
        const dim =
          hovered !== null && e.source !== hovered && e.target !== hovered;
        const style = broken
          ? dim
            ? EDGE_STYLES.brokenDim
            : EDGE_STYLES.broken
          : inferred
            ? dim
              ? EDGE_STYLES.inferredDim
              : EDGE_STYLES.inferred
            : dim
              ? EDGE_STYLES.normalDim
              : EDGE_STYLES.normal;
        return e.style === style ? e : { ...e, style };
      }),
    );
  }, [hovered, metaById, neighbors, setNodes, setEdges]);

  const inferredCount = useMemo(
    () => edges.filter((e) => e.data?.kind === 'inferred').length,
    [edges],
  );

  // Chip/toggle só oculta do render — o estado de edges (e a contagem) segue intacto.
  const visibleEdges = useMemo(
    () => (showInferred ? edges : edges.filter((e) => e.data?.kind !== 'inferred')),
    [edges, showInferred],
  );

  async function handleSuppressConfirmed() {
    if (!confirmRemove) return;
    const { id, sourcePath, targetPath } = confirmRemove;
    setConfirmRemove(null);
    const removed = edges.find((e) => e.id === id);
    // Otimista: some da tela antes da resposta da API.
    setEdges((prev) => prev.filter((e) => e.id !== id));
    setEdgeTooltip(null);
    try {
      await api.suppressEdge(projectId, sourcePath, targetPath);
      toast.success('Relação inferida removida.');
    } catch (err) {
      // Reverte: reinsere a edge removida.
      if (removed) setEdges((prev) => [...prev, removed]);
      toast.error(`Falha ao remover relação: ${err}`);
    }
  }

  return (
    <div className="relative h-full">
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeMouseEnter={(_, node) =>
          setHovered((h) => (h === node.id ? h : node.id))
        }
        onNodeMouseLeave={() => setHovered(null)}
        onNodeClick={(_, node) => {
          const gn = graph.nodes.find((x) => x.docId === node.id);
          if (gn) setSelected(gn);
        }}
        onEdgeMouseEnter={(evt, edge) => {
          if (edge.data?.kind !== 'inferred') return;
          setEdgeTooltip({
            id: edge.id,
            reason: edge.data.reason,
            sourcePath: edge.data.sourcePath,
            targetPath: edge.data.targetPath,
            x: evt.clientX,
            y: evt.clientY,
          });
        }}
        onEdgeMouseLeave={() => setEdgeTooltip(null)}
        fitView
        fitViewOptions={FIT_OPTS}
        minZoom={0.1}
        maxZoom={2}
        proOptions={PRO_OPTS}
      >
        <Background color="#EAECF0" gap={20} />
        <MiniMap
          nodeColor={(n) => (n.style?.background as string) ?? '#1D2939'}
          maskColor="rgba(0,0,0,0.05)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      <Legend />

      {inferredCount > 0 && (
        <div className="absolute right-3 top-3 z-10 flex max-w-xs flex-col gap-2 rounded-md border border-warning/40 bg-surface/90 p-3 text-xs backdrop-blur">
          <label className="flex cursor-pointer items-center gap-1.5 font-medium text-warning">
            <input
              type="checkbox"
              checked={showInferred}
              onChange={(e) => setShowInferred(e.target.checked)}
              aria-label="Mostrar relações inferidas"
            />
            {inferredCount} inferida{inferredCount === 1 ? '' : 's'}
          </label>

          {/* Painel de arestas inferidas — caminho por teclado para o botão
              remover (arestas do react-flow não são tabbable nativamente). */}
          {showInferred && (
            <ul className="flex flex-col gap-1.5 border-t border-border pt-2">
              {edges
                .filter((e) => e.data?.kind === 'inferred')
                .map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span
                      className="truncate text-text-muted"
                      title={`${e.data!.sourcePath} → ${e.data!.targetPath}`}
                    >
                      {e.data!.sourcePath} → {e.data!.targetPath}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded border border-error/40 px-1.5 py-0.5 text-xs font-semibold text-error hover:bg-error/10"
                      aria-label={`Remover relação inferida de ${e.data!.sourcePath} para ${e.data!.targetPath}`}
                      onClick={() =>
                        setConfirmRemove({
                          id: e.id,
                          sourcePath: e.data!.sourcePath,
                          targetPath: e.data!.targetPath,
                        })
                      }
                    >
                      Remover
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {edgeTooltip && (
        <div
          className="pointer-events-none fixed z-30 max-w-xs rounded-md border border-warning/40 bg-surface p-2.5 text-xs shadow-lg"
          style={{ left: edgeTooltip.x + 12, top: edgeTooltip.y + 12 }}
        >
          <p className="font-semibold text-warning">Relação inferida</p>
          <p className="mt-1 text-text-muted">
            {edgeTooltip.reason ?? 'Sem motivo registrado.'}
          </p>
          <button
            type="button"
            className="pointer-events-auto mt-2 rounded border border-error/40 px-2 py-1 text-xs font-semibold text-error hover:bg-error/10"
            onClick={() =>
              setConfirmRemove({
                id: edgeTooltip.id,
                sourcePath: edgeTooltip.sourcePath,
                targetPath: edgeTooltip.targetPath,
              })
            }
          >
            Remover relação
          </button>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remover relação inferida"
          message={`Suprimir a relação entre "${confirmRemove.sourcePath}" e "${confirmRemove.targetPath}"? Ela não volta em um novo sync, a menos que você a restaure depois.`}
          confirmLabel="Remover"
          danger
          onConfirm={() => void handleSuppressConfirmed()}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {selected && (
        <ErrorBoundary
          key={selected.docId}
          fallback={(err, reset) => (
            <aside className="absolute right-0 top-0 z-20 flex h-full w-[420px] flex-col border-l border-border bg-surface p-4 shadow-lg">
              <button
                onClick={() => {
                  reset();
                  setSelected(null);
                }}
                className="self-end text-text-muted hover:text-text"
              >
                ✕
              </button>
              <p className="mt-2 text-sm text-error">
                Erro ao exibir o documento: {err.message}
              </p>
            </aside>
          )}
        >
          <DocViewerPanel
            projectId={projectId}
            path={selected.path}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

function buildGraph(graph: DocGraph): {
  simNodes: SimNode[];
  simLinks: SimLink[];
  neighbors: Map<string, Set<string>>;
} {
  const simNodes: SimNode[] = graph.nodes.map((n) => ({
    id: n.docId,
    label: n.path,
    kind: n.kind,
    path: n.path,
  }));

  // Um nó-fantasma por targetPath quebrado (deduplicado).
  const ghostId = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.broken && !ghostId.has(e.targetPath)) {
      const id = `ghost:${e.targetPath}`;
      ghostId.set(e.targetPath, id);
      simNodes.push({ id, label: e.targetPath, kind: 'ghost', path: null });
    }
  }

  const pathById = new Map(graph.nodes.map((n) => [n.docId, n.path]));

  const simLinks: SimLink[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.broken ? ghostId.get(e.targetPath)! : e.target!,
    broken: e.broken,
    kind: e.kind,
    reason: e.reason,
    sourcePath: pathById.get(e.source) ?? e.source,
    targetPath: e.targetPath,
  }));

  const neighbors = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a)!.add(b);
  };
  for (const l of simLinks) {
    add(l.source, l.target);
    add(l.target, l.source);
  }

  return { simNodes, simLinks, neighbors };
}

function Legend() {
  const items = [
    { c: KIND_COLOR.readme, l: 'README' },
    { c: KIND_COLOR.claude, l: 'CLAUDE.md' },
    { c: KIND_COLOR.doc, l: 'Documento' },
    { c: '#F04438', l: 'Link quebrado', dashed: true },
    { c: 'var(--color-warning)', l: 'Relação inferida', dashed: true },
  ];
  return (
    <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5 rounded-md border border-border bg-surface/90 p-3 text-xs backdrop-blur">
      {items.map((it) => (
        <div key={it.l} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{
              background: it.dashed
                ? `color-mix(in srgb, ${it.c} 10%, transparent)`
                : it.c,
              border: it.dashed ? `1px dashed ${it.c}` : 'none',
            }}
          />
          {it.l}
        </div>
      ))}
    </div>
  );
}
