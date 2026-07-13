import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /** Chave de persistência no localStorage (largura lembrada entre sessões). */
  storageKey: string;
  /** Largura inicial se nada foi salvo (px). */
  initial: number;
  min: number;
  /** Máximo absoluto em px; combinado com maxViewportRatio (o menor vence). */
  max: number;
  /** Teto relativo à largura da janela (ex.: 0.6 = 60% da tela). */
  maxViewportRatio?: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function readStored(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Largura arrastável de um painel, lembrada no localStorage. Retorna a largura
 * atual, se está arrastando, e o handler pro handle (onMouseDown/onKeyDown).
 * Arrastar move a divisória; setas ajustam fino no teclado (acessível).
 */
export function useResizableWidth({
  storageKey,
  initial,
  min,
  max,
  maxViewportRatio = 0.6,
}: Options) {
  const [width, setWidth] = useState(() => readStored(storageKey, initial));
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  const effectiveMax = useCallback(
    () => Math.min(max, Math.round(window.innerWidth * maxViewportRatio)),
    [max, maxViewportRatio],
  );

  const commit = useCallback(
    (next: number) => {
      const clamped = clamp(next, min, effectiveMax());
      setWidth(clamped);
      try {
        localStorage.setItem(storageKey, String(clamped));
      } catch {
        /* localStorage indisponível — largura vale só nesta sessão */
      }
    },
    [min, effectiveMax, storageKey],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      setDragging(true);

      const onMove = (ev: MouseEvent) => {
        // rAF: uma atualização por frame, sem jank ao arrastar rápido.
        if (frame.current !== null) return;
        const clientX = ev.clientX;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const next = clamp(startWidth + (clientX - startX), min, effectiveMax());
          setWidth(next);
        });
      };
      const onUp = () => {
        setDragging(false);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // persiste a largura final (o setWidth do onMove não grava a cada frame)
        setWidth((w) => {
          try {
            localStorage.setItem(storageKey, String(w));
          } catch {
            /* ignore */
          }
          return w;
        });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width, min, effectiveMax, storageKey],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 40 : 12;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commit(width - step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        commit(width + step);
      }
    },
    [width, commit],
  );

  // Reclampa se a janela encolher abaixo do que a largura salva permitia.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w, min, effectiveMax()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [min, effectiveMax]);

  return { width, dragging, onMouseDown, onKeyDown };
}
