import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MiniMap,
  Node,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api, DocGraph, GraphNode } from '../../lib/api';
import { DocViewerPanel } from './DocViewerPanel';

interface Props {
  projectId: string;
  syncNonce: number;
}

const KIND_COLOR: Record<string, string> = {
  readme: '#12B76A', // success
  claude: '#6172F3', // azul info
  doc: '#1D2939', // carbono (brand)
};

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: string;
  broken: boolean;
  path: string | null; // null para nós-fantasma (quebrados)
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
      <GraphCanvas projectId={projectId} graph={state.graph} />
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
  const { fitView } = useReactFlow();
  const computedRef = useRef(false);

  // Monta nós (reais + fantasmas para alvos quebrados) e arestas.
  const { simNodes, simLinks, neighbors } = useMemo(
    () => buildGraph(graph),
    [graph],
  );

  // Layout de força: roda a simulação uma vez (posições estáticas depois).
  const positioned = useMemo(() => {
    const nodes = simNodes.map((n) => ({ ...n }));
    const links = simLinks.map((l) => ({ ...l }));
    const sim = forceSimulation(nodes)
      .force('charge', forceManyBody().strength(-320))
      .force(
        'link',
        forceLink(links)
          .id((d: SimulationNodeDatum & { id?: string }) => d.id!)
          .distance(120),
      )
      .force('center', forceCenter(0, 0))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    return nodes;
  }, [simNodes, simLinks]);

  const rfNodes: Node[] = positioned.map((n) => {
    const dim = hovered !== null && hovered !== n.id && !neighbors.get(hovered)?.has(n.id);
    return {
      id: n.id,
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      data: { label: n.label },
      style: nodeStyle(n, dim),
      type: 'default',
    };
  });

  const rfEdges: Edge[] = simLinks.map((l, i) => {
    const dim =
      hovered !== null && l.source !== hovered && l.target !== hovered;
    return {
      id: `e${i}`,
      source: typeof l.source === 'string' ? l.source : (l.source as SimNode).id,
      target: typeof l.target === 'string' ? l.target : (l.target as SimNode).id,
      animated: false,
      style: {
        stroke: l.broken ? '#F04438' : '#D0D5DD',
        strokeDasharray: l.broken ? '4 4' : undefined,
        opacity: dim ? 0.15 : 1,
        transition: 'opacity 150ms',
      },
    };
  });

  return (
    <div className="relative h-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodeMouseEnter={(_, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onNodeClick={(_, node) => {
          const gn = graph.nodes.find((x) => x.docId === node.id);
          if (gn) setSelected(gn);
        }}
        onInit={() => {
          if (!computedRef.current) {
            computedRef.current = true;
            setTimeout(() => fitView({ padding: 0.2 }), 0);
          }
        }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#EAECF0" gap={20} />
        <MiniMap
          nodeColor={(n) => (n.style?.background as string) ?? '#1D2939'}
          maskColor="rgba(0,0,0,0.05)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      <Legend />

      {selected && (
        <DocViewerPanel
          projectId={projectId}
          path={selected.path}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface SimLink {
  source: string;
  target: string;
  broken: boolean;
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
    broken: false,
    path: n.path,
  }));

  // Um nó-fantasma por targetPath quebrado (deduplicado).
  const ghostId = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.broken && !ghostId.has(e.targetPath)) {
      const id = `ghost:${e.targetPath}`;
      ghostId.set(e.targetPath, id);
      simNodes.push({
        id,
        label: e.targetPath,
        kind: 'ghost',
        broken: true,
        path: null,
      });
    }
  }

  const simLinks: SimLink[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.broken ? ghostId.get(e.targetPath)! : e.target!,
    broken: e.broken,
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

function nodeStyle(n: SimNode, dim: boolean): React.CSSProperties {
  if (n.broken) {
    return {
      background: '#FEF3F2',
      border: '1px dashed #F04438',
      color: '#B42318',
      borderRadius: 8,
      fontSize: 11,
      padding: '6px 10px',
      opacity: dim ? 0.2 : 1,
      transition: 'opacity 150ms',
    };
  }
  const color = KIND_COLOR[n.kind] ?? KIND_COLOR.doc;
  return {
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 11,
    padding: '6px 10px',
    opacity: dim ? 0.2 : 1,
    transition: 'opacity 150ms',
  };
}

function Legend() {
  const items = [
    { c: KIND_COLOR.readme, l: 'README' },
    { c: KIND_COLOR.claude, l: 'CLAUDE.md' },
    { c: KIND_COLOR.doc, l: 'Documento' },
    { c: '#F04438', l: 'Link quebrado', dashed: true },
  ];
  return (
    <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5 rounded-md border border-border bg-surface/90 p-3 text-xs backdrop-blur">
      {items.map((it) => (
        <div key={it.l} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{
              background: it.dashed ? '#FEF3F2' : it.c,
              border: it.dashed ? `1px dashed ${it.c}` : 'none',
            }}
          />
          {it.l}
        </div>
      ))}
    </div>
  );
}
