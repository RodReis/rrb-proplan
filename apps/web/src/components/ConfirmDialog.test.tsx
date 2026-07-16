import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Smoke da camada "Tela" (ADR-019): prova que o harness Vitest + Testing Library
 * roda e que o ConfirmDialog tem comportamento real — não é `expect(true)`.
 */
describe('ConfirmDialog', () => {
  it('renderiza título, mensagem e o rótulo de confirmação', () => {
    render(
      <ConfirmDialog
        title="Descartar card?"
        message="Isso move o card para Descartado."
        confirmLabel="Descartar"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Descartar card?')).toBeInTheDocument();
    expect(
      screen.getByText('Isso move o card para Descartado.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Descartar' }),
    ).toBeInTheDocument();
  });

  it('dispara onConfirm ao clicar em confirmar', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="Sim"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('fecha (onCancel) ao apertar Esc', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
