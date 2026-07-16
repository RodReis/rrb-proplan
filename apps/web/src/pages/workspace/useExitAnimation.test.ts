import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExitAnimation } from './useExitAnimation';

/** Finge a resposta do `prefers-reduced-motion` para este teste. */
function mockReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
}

describe('useExitAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renderiza de imediato ao abrir', () => {
    const { result } = renderHook(() => useExitAnimation(true, 240));
    expect(result.current.rendered).toBe(true);
    expect(result.current.leaving).toBe(false);
  });

  // O ponto do hook: o nó sobrevive ao fechar até a animação terminar. Sem
  // isso o React desmonta no mesmo quadro e a saída nunca aparece.
  it('segura o nó durante a saída e só então desmonta', () => {
    const { result, rerender } = renderHook(({ open }) => useExitAnimation(open, 240), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current.rendered).toBe(true);
    expect(result.current.leaving).toBe(true);

    act(() => void vi.advanceTimersByTime(240));
    expect(result.current.rendered).toBe(false);
    expect(result.current.leaving).toBe(false);
  });

  // §11: quem pediu para não ver movimento não pode ficar esperando por um.
  it('desmonta na hora sob prefers-reduced-motion', () => {
    mockReducedMotion(true);
    const { result, rerender } = renderHook(({ open }) => useExitAnimation(open, 240), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current.rendered).toBe(false);
    expect(result.current.leaving).toBe(false);
  });

  it('cancela a saída quando reabre no meio dela', () => {
    const { result, rerender } = renderHook(({ open }) => useExitAnimation(open, 240), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    act(() => void vi.advanceTimersByTime(100)); // metade do caminho
    rerender({ open: true });

    expect(result.current.rendered).toBe(true);
    expect(result.current.leaving).toBe(false);

    // O timer da saída anterior não pode derrubar o nó que voltou a abrir.
    act(() => void vi.advanceTimersByTime(240));
    expect(result.current.rendered).toBe(true);
  });

  it('não renderiza quando nasce fechado', () => {
    const { result } = renderHook(() => useExitAnimation(false, 240));
    expect(result.current.rendered).toBe(false);
  });
});
