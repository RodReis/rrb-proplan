import { describe, expect, it } from 'vitest';
import type { CardEvent } from '../../../lib/api';
import {
  describeEvent,
  EVENT_TYPES,
  labelTextColor,
  splitTimeline,
  timelineNewestFirst,
  TIMELINE_PREVIEW,
} from './cardDetailView';

function event(over: Partial<CardEvent> = {}): CardEvent {
  return {
    type: 'opened',
    actor: { login: 'RodReis', avatarUrl: 'a' },
    createdAt: '2026-07-25T20:00:00Z',
    ...over,
  };
}

/** N eventos com carimbos crescentes — como a API os entrega. */
function series(n: number): CardEvent[] {
  return Array.from({ length: n }, (_, i) =>
    event({ createdAt: `2026-07-25T20:${String(i).padStart(2, '0')}:00Z` }),
  );
}

describe('timelineNewestFirst', () => {
  it('inverte a ordem — ao abrir o card, o que importa é o que acabou de acontecer', () => {
    const events = timelineNewestFirst([
      event({ type: 'opened', createdAt: '2026-07-25T20:00:00Z' }),
      event({ type: 'labeled', createdAt: '2026-07-25T20:01:00Z' }),
      event({ type: 'closed', createdAt: '2026-07-25T20:02:00Z' }),
    ]);
    expect(events.map((e) => e.type)).toEqual(['closed', 'labeled', 'opened']);
  });

  it('NÃO muta o array recebido — o mesmo payload pode ser lido duas vezes', () => {
    const original = series(3);
    const antes = original.map((e) => e.createdAt);
    timelineNewestFirst(original);
    expect(original.map((e) => e.createdAt)).toEqual(antes);
  });

  it('lista vazia devolve vazia', () => {
    expect(timelineNewestFirst([])).toEqual([]);
  });
});

describe('splitTimeline', () => {
  it(`mostra ${TIMELINE_PREVIEW} e conta o resto como escondido`, () => {
    const { visible, hiddenCount } = splitTimeline(series(14), false);
    expect(visible).toHaveLength(TIMELINE_PREVIEW);
    expect(hiddenCount).toBe(4);
  });

  it('expandido mostra todos e zera o contador — sem paginar contra o GitHub', () => {
    const { visible, hiddenCount } = splitTimeline(series(14), true);
    expect(visible).toHaveLength(14);
    expect(hiddenCount).toBe(0);
  });

  it('no limite exato não oferece "ver todos" — não há o que ver', () => {
    const { visible, hiddenCount } = splitTimeline(series(TIMELINE_PREVIEW), false);
    expect(visible).toHaveLength(TIMELINE_PREVIEW);
    expect(hiddenCount).toBe(0);
  });

  it('abaixo do limite mostra tudo sem contador', () => {
    expect(splitTimeline(series(3), false)).toEqual({
      visible: splitTimeline(series(3), false).visible,
      hiddenCount: 0,
    });
    expect(splitTimeline(series(3), false).visible).toHaveLength(3);
  });

  it('o corte pega os MAIS RECENTES, não os primeiros', () => {
    const { visible } = splitTimeline(series(12), false);
    // series(12) vai de 20:00 a 20:11; invertido, o primeiro visível é 20:11 e
    // o último visível é 20:02 — os dois mais antigos (20:00, 20:01) somem.
    expect(visible[0].createdAt).toBe('2026-07-25T20:11:00Z');
    expect(visible[visible.length - 1].createdAt).toBe('2026-07-25T20:02:00Z');
  });

  it('trilha vazia não oferece "ver todos"', () => {
    expect(splitTimeline([], false)).toEqual({ visible: [], hiddenCount: 0 });
  });
});

describe('describeEvent', () => {
  it('descreve os 8 tipos do contrato sem cair em string vazia', () => {
    for (const type of EVENT_TYPES) {
      const frase = describeEvent(event({ type }));
      expect(frase).toMatch(/RodReis/);
      expect(frase.length).toBeGreaterThan('RodReis'.length);
    }
  });

  it('ator ausente vira "alguém" — trilha não fica muda nem inventa nome', () => {
    expect(describeEvent(event({ type: 'closed', actor: null }))).toBe('alguém fechou');
  });

  it('nomeia o responsável em assigned/unassigned quando o payload traz', () => {
    expect(
      describeEvent(event({ type: 'assigned', assignee: { login: 'outro' } })),
    ).toBe('RodReis atribuiu a outro');
    expect(
      describeEvent(event({ type: 'unassigned', assignee: { login: 'outro' } })),
    ).toBe('RodReis removeu a atribuição de outro');
  });

  it('assigned sem assignee não escreve "atribuiu a undefined"', () => {
    const frase = describeEvent(event({ type: 'assigned' }));
    expect(frase).toBe('RodReis atribuiu');
    expect(frase).not.toMatch(/undefined/);
  });

  it('labeled/unlabeled não repetem o nome da label na frase (o chip a mostra)', () => {
    expect(
      describeEvent(
        event({ type: 'labeled', label: { name: 'proplan:doing', color: '0e8a16' } }),
      ),
    ).toBe('RodReis adicionou');
  });
});

describe('labelTextColor', () => {
  it('fundo claro pede texto escuro — fbca04 com branco fica ilegível', () => {
    expect(labelTextColor('fbca04')).toBe('#000');
    expect(labelTextColor('ffffff')).toBe('#000');
  });

  it('fundo escuro pede texto claro', () => {
    expect(labelTextColor('0e8a16')).toBe('#fff');
    expect(labelTextColor('000000')).toBe('#fff');
    expect(labelTextColor('b60205')).toBe('#fff');
  });

  it('aceita hex com # (o GitHub manda sem, mas não confiar nisso)', () => {
    expect(labelTextColor('#fbca04')).toBe('#000');
  });

  it('hex inesperado cai no escuro em vez de quebrar', () => {
    expect(labelTextColor('')).toBe('#000');
    expect(labelTextColor('xyz')).toBe('#000');
    expect(labelTextColor('zzzzzz')).toBe('#000');
  });
});
