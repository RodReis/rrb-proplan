/**
 * Passos nomeados de cada fluxo de escrita (SPEC-010, Camada 1). O texto é
 * CONTEÚDO, não log: português, na voz de quem explica a um humano o que está
 * acontecendo com o repositório dele. Nunca jargão (202, docsTreeSha, enqueueSync).
 *
 * Puro e determinístico — a fábrica dos passos vive aqui para ser testável sem
 * banco. O ActivityService só persiste e avança o que este módulo define.
 */

export type OperationKind = 'promote' | 'mapping' | 'bootstrap' | 'board_mutation';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Step {
  /** Chave estável para o service avançar o passo certo (não é exibida). */
  key: string;
  /** Texto exibido ao usuário. */
  label: string;
  status: StepStatus;
}

/**
 * `{doc}` no label é substituído pelo caminho real (ex.: docs/ARCHITECTURE.md).
 * Fluxos sem doc específico ignoram o placeholder.
 */
const STEP_TEMPLATES: Record<OperationKind, { key: string; label: string }[]> = {
  promote: [
    { key: 'commit', label: 'Commitando {doc} no repositório…' },
    { key: 'propagate', label: 'Aguardando o GitHub propagar o commit…' },
    { key: 'sync', label: 'Sincronizando a documentação…' },
    { key: 'done', label: 'Pronto — a aba agora usa o documento real' },
  ],
  mapping: [
    { key: 'commit', label: 'Salvando o mapeamento em {doc}…' },
    { key: 'propagate', label: 'Aguardando o GitHub propagar…' },
    { key: 'sync', label: 'Sincronizando a documentação…' },
    { key: 'done', label: 'Pronto — o mapeamento está ativo' },
  ],
  bootstrap: [
    { key: 'commit', label: 'Commitando {doc} no repositório…' },
    { key: 'propagate', label: 'Aguardando o GitHub propagar…' },
    { key: 'sync', label: 'Sincronizando a documentação…' },
    { key: 'done', label: 'Pronto — o documento foi criado' },
  ],
  board_mutation: [
    { key: 'mutate', label: 'Atualizando a issue no GitHub…' },
    { key: 'confirm', label: 'Confirmando a mudança…' },
    { key: 'done', label: 'Pronto — o card foi movido' },
  ],
};

/** Monta os passos iniciais de uma operação (todos `pending`). */
export function buildSteps(kind: OperationKind, doc?: string): Step[] {
  return STEP_TEMPLATES[kind].map((t) => ({
    key: t.key,
    label: t.label.replace('{doc}', doc ?? 'o documento'),
    status: 'pending' as const,
  }));
}

/**
 * Marca o passo `key` como `running` e todos os anteriores como `done`.
 * Idempotente: avançar para um passo já passado não regride os posteriores.
 * Retorna nova lista (imutável).
 */
export function advanceTo(steps: Step[], key: string): Step[] {
  const idx = steps.findIndex((s) => s.key === key);
  if (idx === -1) return steps;
  return steps.map((s, i) => {
    if (i < idx) return { ...s, status: 'done' as const };
    if (i === idx) return { ...s, status: 'running' as const };
    return s;
  });
}

/** Marca todos os passos como `done` (operação concluída). */
export function markAllDone(steps: Step[]): Step[] {
  return steps.map((s) => ({ ...s, status: 'done' as const }));
}

/** Marca o passo `running` (ou o primeiro `pending`) como `failed`. */
export function markFailed(steps: Step[]): Step[] {
  const idx = steps.findIndex((s) => s.status === 'running');
  const target = idx === -1 ? steps.findIndex((s) => s.status === 'pending') : idx;
  if (target === -1) return steps;
  return steps.map((s, i) => (i === target ? { ...s, status: 'failed' as const } : s));
}
