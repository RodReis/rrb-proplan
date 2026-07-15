/** Abas do workspace (DESIGN.md). "Documentos" é a única ativa na Fatia 2. */
export interface TabDef {
  id: string;
  label: string;
  /** Fatia em que a aba passa a funcionar (tooltip nas desabilitadas). */
  enabledIn: number | null;
}

export const WORKSPACE_TABS: TabDef[] = [
  { id: 'overview', label: 'Visão Geral', enabledIn: 3 },
  { id: 'documents', label: 'Documentos', enabledIn: 2 },
  { id: 'kanban', label: 'Kanban', enabledIn: 5 },
  { id: 'graph', label: 'Grafo', enabledIn: 4 },
  { id: 'decisions', label: 'Decisões', enabledIn: 6 },
  { id: 'architecture', label: 'Arquitetura', enabledIn: 6 },
  { id: 'skills', label: 'Skills & Agentes', enabledIn: 6 },
  { id: 'tests', label: 'Testes', enabledIn: 6 },
  { id: 'design', label: 'Design', enabledIn: 6 },
  { id: 'deploy', label: 'Deploy', enabledIn: 6 },
  { id: 'context', label: 'Contexto', enabledIn: 10 },
  { id: 'handoff', label: 'Handoff', enabledIn: 13 },
];

export const CURRENT_SLICE = 13;
