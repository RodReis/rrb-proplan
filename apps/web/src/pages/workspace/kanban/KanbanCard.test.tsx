import { describe, expect, it } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { BoardCard } from '../../../lib/api';
import { ThemeProvider } from '../../../theme';
import { formatStamp, KanbanCard } from './KanbanCard';

/**
 * O formato do carimbo é `dd/MM/aaaa 'às' hh:mm` (decisão do PI, 2026-07-16).
 *
 * O fuso vai por parâmetro, não por `process.env.TZ`: a 1ª versão deste teste
 * setava a env num `beforeAll` e passava — mas por coincidência (minha máquina
 * já é São Paulo). O ICU resolve o fuso quando o processo sobe, então a env
 * depois disso não faz nada, e no CI (UTC) os 3 casos de hora quebravam. Fuso
 * explícito é o único jeito de o teste provar a mesma coisa nas duas máquinas.
 */
const SP = 'America/Sao_Paulo';

describe('formatStamp', () => {
  it('formata ISO do GitHub como dd/MM/aaaa às hh:mm', () => {
    // 2026-07-16T20:52:47Z = 17:52 em São Paulo (UTC-3)
    expect(formatStamp('2026-07-16T20:52:47Z', SP)).toBe('16/07/2026 às 17:52');
  });

  it('usa relógio de 24h — meia-noite é 00:xx, nunca 24:xx', () => {
    expect(formatStamp('2026-07-17T03:05:00Z', SP)).toBe('17/07/2026 às 00:05');
  });

  it('zero-padding em dia, mês e hora de um dígito', () => {
    expect(formatStamp('2026-01-05T12:07:00Z', SP)).toBe('05/01/2026 às 09:07');
  });

  it('formata no fuso pedido — o mesmo instante em UTC', () => {
    expect(formatStamp('2026-07-16T20:52:47Z', 'UTC')).toBe('16/07/2026 às 20:52');
  });

  it('null → null (card sem a data não inventa uma)', () => {
    expect(formatStamp(null)).toBeNull();
  });

  it('ISO inválido → null, nunca "Invalid Date" na tela', () => {
    expect(formatStamp('nao-e-data')).toBeNull();
  });
});

const card: BoardCard = {
  number: 128,
  title: '[SPEC-030] Painel de detalhe do card: corpo da issue, metadados e trilha',
  column: 'backlog',
  priority: null,
  assignee: null,
  htmlUrl: 'https://github.com/rodreis/rrb-proplan/issues/128',
  createdAt: '2026-07-25T20:19:00Z',
  closedAt: null,
  closedOutside: false,
  parentNumber: null,
};

function renderCard(onEdit = vi.fn(), draggable?: boolean) {
  render(
    <ThemeProvider>
      <DndContext>
        <KanbanCard card={card} onEdit={onEdit} draggable={draggable} />
      </DndContext>
    </ThemeProvider>,
  );
  return onEdit;
}

describe('KanbanCard', () => {
  // Desde a SPEC-030 o clique abre a gaveta de LEITURA, não o formulário — o
  // rótulo acompanha ("Abrir card"), senão mentiria para leitor de tela.
  it('abre o card ao clicar', async () => {
    const onEdit = renderCard();

    await userEvent.click(screen.getByRole('button', { name: /abrir card #128/i }));

    expect(onEdit).toHaveBeenCalledWith(card);
  });

  it('mantém o link da issue separado da abertura', async () => {
    const onEdit = renderCard();

    await userEvent.click(screen.getByRole('link', { name: '#128' }));

    expect(onEdit).not.toHaveBeenCalled();
  });

  // Abrir ≠ arrastar (SPEC-030): antes eram a mesma flag (`!!onEdit`), e o
  // efeito colateral era o viewer sem poder nem abrir o card para ler.
  //
  // Declarado ANTES do caso do handle de arrasto, e a ordem é obrigatória: um
  // `userEvent.click` no handle instala listeners de pointer do dnd-kit que o
  // jsdom não desfaz entre renders, e o clique seguinte deixa de virar evento
  // `click` (down/up chegam ao card, `click` nunca é emitido). Medido isolando
  // as combinações: com qualquer outro teste antes, este passa; só o do handle o
  // quebra. Contaminação do ambiente, não defeito do componente.
  it('draggable=false ainda abre o card, mas esconde o handle de arrasto', async () => {
    const onEdit = renderCard(vi.fn(), false);

    expect(
      screen.queryByRole('button', { name: /arrastar card #128/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /abrir card #128/i }));
    expect(onEdit).toHaveBeenCalledWith(card);
  });

  it('expõe handle dedicado de arrasto sem abrir o card no clique', async () => {
    const onEdit = renderCard();

    await userEvent.click(screen.getByRole('button', { name: /arrastar card #128/i }));

    expect(onEdit).not.toHaveBeenCalled();
  });

  it('sem onEdit o card não é clicável nem arrastável', () => {
    render(
      <ThemeProvider>
        <DndContext>
          <KanbanCard card={card} />
        </DndContext>
      </ThemeProvider>,
    );

    expect(screen.queryByRole('button', { name: /abrir card/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /arrastar card/i }),
    ).not.toBeInTheDocument();
  });
});
