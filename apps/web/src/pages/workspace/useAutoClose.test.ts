import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoClose } from './useAutoClose';

describe('useAutoClose', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fecha após o delay quando armado', () => {
    const onClose = vi.fn();
    renderHook(() => useAutoClose(true, 0, 4000, onClose));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(4000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('não fecha quando desarmado (aberto pela pílula)', () => {
    const onClose = vi.fn();
    renderHook(() => useAutoClose(false, 0, 4000, onClose));
    act(() => vi.advanceTimersByTime(10000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('re-arma a contagem quando bumpToken muda (interação/trabalho)', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ bump }) => useAutoClose(true, bump, 4000, onClose), {
      initialProps: { bump: 0 },
    });
    act(() => vi.advanceTimersByTime(3000)); // quase fechou
    rerender({ bump: 1 }); // interação reinicia
    act(() => vi.advanceTimersByTime(3000)); // 3s desde o bump < 4s
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000)); // agora completa 4s
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('re-render sem mudar bump NÃO reinicia o timer', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ bump }) => useAutoClose(true, bump, 4000, onClose), {
      initialProps: { bump: 7 },
    });
    act(() => vi.advanceTimersByTime(3000));
    rerender({ bump: 7 }); // mesmo bump: o polling do feed re-renderiza sem interação
    act(() => vi.advanceTimersByTime(1000)); // completa os 4s originais
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('desarmar cancela o timer pendente', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ armed }) => useAutoClose(armed, 0, 4000, onClose), {
      initialProps: { armed: true },
    });
    act(() => vi.advanceTimersByTime(2000));
    rerender({ armed: false });
    act(() => vi.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();
  });
});
