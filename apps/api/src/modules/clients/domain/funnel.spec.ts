import { ClientProjectState } from '@prisma/client';
import {
  COLUMN_OF,
  ENTRY_STATE_OF,
  FUNNEL_COLUMNS,
  allowedTransitions,
  canTransition,
  isFunnelColumn,
  stateForColumnMove,
} from './funnel';

const ALL_STATES = Object.keys(COLUMN_OF) as ClientProjectState[];

describe('funil de clientes: máquina de estados (SPEC-029)', () => {
  describe('transições', () => {
    it('avança um passo no fluxo feliz, do rascunho à entrega', () => {
      const happyPath: ClientProjectState[] = [
        'DRAFT',
        'LINK_SENT',
        'BRIEFING_STARTED',
        'BRIEFING_SUBMITTED',
        'ARTIFACTS_READY',
        'CONTRACT_PENDING',
        'CONTRACT_APPROVED',
        'IN_PRODUCTION',
        'DELIVERED',
      ];
      for (let i = 0; i < happyPath.length - 1; i++) {
        expect(canTransition(happyPath[i], happyPath[i + 1])).toBe(true);
      }
    });

    it('recusa pular etapa — é o caso que a spec exige responder 422', () => {
      expect(canTransition('DRAFT', 'IN_PRODUCTION')).toBe(false);
      expect(canTransition('DRAFT', 'DELIVERED')).toBe(false);
      expect(canTransition('LINK_SENT', 'CONTRACT_APPROVED')).toBe(false);
      expect(canTransition('BRIEFING_STARTED', 'IN_PRODUCTION')).toBe(false);
    });

    it('permite voltar um passo (corrigir engano é rotina)', () => {
      expect(canTransition('LINK_SENT', 'DRAFT')).toBe(true);
      expect(canTransition('BRIEFING_SUBMITTED', 'BRIEFING_STARTED')).toBe(true);
      expect(canTransition('IN_PRODUCTION', 'CONTRACT_APPROVED')).toBe(true);
    });

    it('não permite voltar mais de um passo de uma vez', () => {
      expect(canTransition('BRIEFING_SUBMITTED', 'DRAFT')).toBe(false);
      expect(canTransition('DELIVERED', 'BRIEFING_STARTED')).toBe(false);
    });

    it('arquiva de qualquer estado não-terminal', () => {
      for (const state of ALL_STATES) {
        if (state === 'ARCHIVED') continue;
        expect({ state, canArchive: canTransition(state, 'ARCHIVED') }).toEqual({
          state,
          canArchive: true,
        });
      }
    });

    it('desarquivar volta ao começo do fluxo, não ao estado anterior', () => {
      expect(allowedTransitions('ARCHIVED')).toEqual(['DRAFT']);
    });

    it('nenhum estado transiciona para si mesmo', () => {
      for (const state of ALL_STATES) {
        expect({ state, self: canTransition(state, state) }).toEqual({
          state,
          self: false,
        });
      }
    });

    it('todo estado tem ao menos uma saída (nenhum beco sem saída)', () => {
      for (const state of ALL_STATES) {
        expect({ state, saidas: allowedTransitions(state).length > 0 }).toEqual({
          state,
          saidas: true,
        });
      }
    });

    it('todo destino declarado é um estado conhecido', () => {
      for (const state of ALL_STATES) {
        for (const target of allowedTransitions(state)) {
          expect(ALL_STATES).toContain(target);
        }
      }
    });
  });

  describe('colunas', () => {
    it('todo estado mapeia para uma das 4 colunas', () => {
      for (const state of ALL_STATES) {
        expect(FUNNEL_COLUMNS).toContain(COLUMN_OF[state]);
      }
    });

    it('toda coluna tem estado de entrada, e ele pertence à própria coluna', () => {
      for (const column of FUNNEL_COLUMNS) {
        expect(COLUMN_OF[ENTRY_STATE_OF[column]]).toBe(column);
      }
    });

    it('isFunnelColumn aceita coluna conhecida e recusa o resto', () => {
      expect(isFunnelColumn('briefing')).toBe(true);
      expect(isFunnelColumn('inventada')).toBe(false);
      // Nome de ESTADO não é nome de coluna — é a confusão que a rota precisa barrar.
      expect(isFunnelColumn('DRAFT')).toBe(false);
    });
  });

  describe('drag-and-drop (coluna → estado)', () => {
    it('mover para a coluna seguinte leva ao estado de entrada dela', () => {
      expect(stateForColumnMove('LINK_SENT', 'briefing')).toBe('BRIEFING_STARTED');
      expect(stateForColumnMove('BRIEFING_SUBMITTED', 'prompt_contrato')).toBe(
        'ARTIFACTS_READY',
      );
    });

    it('mover dentro da MESMA coluna não é transição (não suja a trilha)', () => {
      // DRAFT e LINK_SENT vivem os dois na coluna "novo".
      expect(stateForColumnMove('DRAFT', 'novo')).toBeNull();
      expect(stateForColumnMove('LINK_SENT', 'novo')).toBeNull();
      expect(stateForColumnMove('CONTRACT_APPROVED', 'prompt_contrato')).toBeNull();
    });

    it('o alvo do arrasto ainda passa pela validação de transição', () => {
      // A tradução coluna→estado é só tradução: ela devolve IN_PRODUCTION, e é
      // `canTransition` quem recusa o pulo. Se o service confiasse só na
      // tradução, o drag-and-drop viraria a porta dos fundos da máquina de
      // estados — este teste fixa que a checagem é a mesma dos dois caminhos.
      const target = stateForColumnMove('DRAFT', 'producao_entrega');
      expect(target).toBe('IN_PRODUCTION');
      expect(canTransition('DRAFT', target!)).toBe(false);
    });
  });
});
