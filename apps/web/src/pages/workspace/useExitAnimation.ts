import { useEffect, useRef, useState } from 'react';

/**
 * Segura um nó no DOM enquanto ele toca a animação de saída.
 *
 * Sem isto o React desmonta no mesmo quadro em que `open` vira false: a entrada
 * anima e a saída não — o "vai" sem o "volta". Devolve se deve renderizar e se
 * está saindo, para o componente aplicar a classe de saída.
 *
 * Sob `prefers-reduced-motion` a saída é imediata (§11): o usuário pediu para
 * não haver movimento, e esperar por uma animação que não vai acontecer só
 * deixaria o nó preso na tela.
 */
export function useExitAnimation(open: boolean, durationMs: number) {
  const [rendered, setRendered] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);

    if (open) {
      setRendered(true);
      setLeaving(false);
      return;
    }

    if (!rendered) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setRendered(false);
      return;
    }

    setLeaving(true);
    timer.current = setTimeout(() => {
      setRendered(false);
      setLeaving(false);
    }, durationMs);

    return () => clearTimeout(timer.current);
  }, [open, rendered, durationMs]);

  return { rendered, leaving };
}
