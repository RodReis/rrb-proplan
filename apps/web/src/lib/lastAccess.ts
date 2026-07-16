/**
 * Registro local de último acesso por projeto (SPEC-020 §1 — o combo ordena por
 * "mais recente no topo").
 *
 * Local por decisão: é preferência de navegação desta máquina, não fato do
 * repositório. Se um dia virar preferência de usuário, migra junto com o tema
 * (mesma dívida registrada na SPEC-020).
 */
const STORAGE_KEY = 'proplan:lastAccess';

type LastAccessMap = Record<string, number>;

function read(): LastAccessMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // O que vem do storage é entrada não confiável: só sobrevive o que for
    // {string: number} de verdade.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'number' && Number.isFinite(v),
      ),
    ) as LastAccessMap;
  } catch {
    // Storage indisponível ou JSON corrompido — a ordem cai no fallback.
    return {};
  }
}

/** Marca o projeto como aberto agora. */
export function touchProject(projectId: string): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...read(), [projectId]: Date.now() }),
    );
  } catch {
    // Sem persistência a ordem degrada para a da API — não é erro de usuário.
  }
}

/**
 * Ordena por último acesso (mais recente primeiro). Projeto nunca aberto vai
 * para o fim, preservando a ordem de origem entre os desconhecidos.
 */
export function sortByLastAccess<T extends { id: string }>(projects: T[]): T[] {
  const map = read();
  return [...projects].sort((a, b) => (map[b.id] ?? 0) - (map[a.id] ?? 0));
}
