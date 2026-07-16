import { useEffect, useState } from 'react';
import { api, type OperationView } from '../../../lib/api';

interface Props {
  projectId: string;
  /** Sync em curso disparado pela topbar — a pílula narra antes do 1º poll. */
  syncing: boolean;
  /** Muda quando um sync/promote termina — reancora o poll. */
  refreshNonce: number;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  lastSyncAt: string | null;
}

const ACTIVE_POLL_MS = 2000;
const REST_POLL_MS = 15000;

/**
 * Pílula viva de atividade (DESIGN.md §6) — a 1ª das 3 camadas do "sem
 * silêncio" (§7). Substitui o botão `Atividade`: clicar abre a gaveta.
 *
 * Consome o que a SPEC-010 já emite (`activity/running`) — nenhum backend novo.
 */
export function ActivityPill({
  projectId,
  syncing,
  refreshNonce,
  drawerOpen,
  onOpenDrawer,
  lastSyncAt,
}: Props) {
  const [running, setRunning] = useState<OperationView[]>([]);
  // Escrita concluída com a gaveta fechada ganha badge verde (§6).
  const [justFinished, setJustFinished] = useState(false);

  const busy = syncing || running.length > 0;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const ops = await api.activityRunning(projectId);
        if (!alive) return;
        setRunning((prev) => {
          // Passou de "havia operação" para "nenhuma" = algo acabou agora.
          if (prev.length > 0 && ops.length === 0 && !drawerOpen) {
            setJustFinished(true);
          }
          return ops;
        });
        timer = setTimeout(tick, ops.length ? ACTIVE_POLL_MS : REST_POLL_MS);
      } catch {
        // Falha de poll não é falha de operação: segue tentando devagar.
        if (alive) timer = setTimeout(tick, REST_POLL_MS);
      }
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, refreshNonce, drawerOpen]);

  useEffect(() => {
    if (drawerOpen) setJustFinished(false);
  }, [drawerOpen]);

  // Passo ativo da operação mais recente — é o que a pílula narra.
  const step = running[0]?.steps.find((s) => s.status === 'running');
  const label = busy
    ? (step?.label ?? 'Sincronizando…')
    : `Em dia · sync ${formatAgo(lastSyncAt)}`;

  return (
    <button
      onClick={onOpenDrawer}
      aria-live="polite"
      title={label}
      className={
        'flex h-[34px] min-w-[34px] shrink items-center justify-center gap-2 rounded-full border px-3 transition-colors duration-150 ' +
        (busy
          ? 'border-info/40 bg-info/10 text-info'
          : 'border-border2 text-body2 hover:border-hoverb hover:text-text')
      }
      style={busy ? undefined : { ['--pulse' as string]: 'color-mix(in srgb, var(--success) 40%, transparent)' }}
    >
      <span
        aria-hidden
        className={'h-2 w-2 shrink-0 rounded-full ' + (busy ? '' : 'anim-pulse')}
        style={{ background: busy ? 'var(--info)' : 'var(--success)' }}
      />
      {/* Segundo a ceder quando a topbar aperta: o texto some e sobra o ponto
          de estado (o `title` mantém a informação a um hover). O ponto sozinho
          ainda diz o essencial — e clicar continua abrindo a gaveta. */}
      <span
        className={
          'hidden max-w-[260px] truncate text-[11px] lg:inline ' +
          (busy ? 'font-mono tracking-[0.02em]' : '')
        }
      >
        {label}
      </span>
      {justFinished && !busy && (
        <span
          aria-hidden
          className="anim-popIn h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: 'var(--success)' }}
        />
      )}
    </button>
  );
}

/** "há 2 h" / "há 5 min" / "agora" — nunca timestamp cru (§7: sem jargão). */
function formatAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'agora';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
