import { parse } from 'yaml';

export interface WorkflowInfo {
  file: string;
  name: string;
  triggers: string[];
  jobs: { name: string; runsOn: string | null }[];
}

function triggersOf(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === 'object') return Object.keys(on as Record<string, unknown>);
  return [];
}

/** Parseia um workflow do GitHub Actions: name, gatilhos (on), jobs (nome +
 *  runs-on). Não interpreta steps. YAML quebrado → null. */
export function parseWorkflow(path: string, content: string): WorkflowInfo | null {
  try {
    const doc = parse(content) as { name?: unknown; on?: unknown; jobs?: Record<string, { 'runs-on'?: unknown }> } | null;
    if (!doc || typeof doc !== 'object') return null;
    const jobsObj = doc.jobs ?? {};
    const jobs = Object.entries(jobsObj).map(([name, def]) => ({
      name,
      runsOn: def && typeof def['runs-on'] === 'string' ? (def['runs-on'] as string) : null,
    }));
    return {
      file: path,
      name: typeof doc.name === 'string' ? doc.name : (path.split('/').pop() ?? path),
      triggers: triggersOf(doc.on),
      jobs,
    };
  } catch {
    return null;
  }
}
