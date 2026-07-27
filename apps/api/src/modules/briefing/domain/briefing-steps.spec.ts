import {
  STEP_COUNT,
  isValidStep,
  requiredFieldsOf,
  validateStep,
  validateAllSteps,
  completedStepCount,
  mergeAnswers,
} from './briefing-steps';

/**
 * As 9 etapas (SPEC-031 §1). Regra PURA — sem Prisma, sem HTTP.
 *
 * O que estes testes protegem é a frase da spec: *"validação de tela é
 * conveniência; a barreira é a API"*. Se a validação morasse no controller ou
 * no componente React, não haveria como provar a barreira sem subir os dois.
 */
describe('briefing-steps: as 9 etapas', () => {
  describe('formato da etapa', () => {
    it('são exatamente 9 etapas', () => {
      expect(STEP_COUNT).toBe(9);
    });

    it('aceita 1..9 e recusa fora do intervalo', () => {
      expect(isValidStep(1)).toBe(true);
      expect(isValidStep(9)).toBe(true);
      expect(isValidStep(0)).toBe(false);
      expect(isValidStep(10)).toBe(false);
      expect(isValidStep(2.5)).toBe(false);
      expect(isValidStep(Number.NaN)).toBe(false);
    });
  });

  describe('obrigatoriedade por etapa (spec §1: só 1, 2, 4 e 9)', () => {
    it('as etapas 1, 2, 4 e 9 têm campo obrigatório', () => {
      for (const step of [1, 2, 4, 9]) {
        expect(requiredFieldsOf(step).length).toBeGreaterThan(0);
      }
    });

    it('as etapas 3, 5, 6, 7 e 8 podem ser enviadas vazias', () => {
      // "Ausência é informação" (ADR-014): o pipeline recebe "não informado",
      // nunca um valor inventado. Exigir resposta aqui produziria dado falso.
      for (const step of [3, 5, 6, 7, 8]) {
        expect(requiredFieldsOf(step)).toEqual([]);
        expect(validateStep(step, {}).ok).toBe(true);
      }
    });
  });

  describe('validateStep', () => {
    it('etapa 1 exige empresa e segmento', () => {
      const vazio = validateStep(1, {});
      expect(vazio.ok).toBe(false);
      expect(vazio.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'company' }),
          expect.objectContaining({ field: 'segment' }),
        ]),
      );

      expect(
        validateStep(1, { company: 'ACME', segment: 'J' }).ok,
      ).toBe(true);
    });

    it('string só com espaço não satisfaz obrigatório', () => {
      // O caso que passa despercebido: `"   "` é truthy em JS.
      expect(validateStep(1, { company: '   ', segment: 'J' }).ok).toBe(false);
    });

    it('etapa 9 exige nível de complexidade dentre os três', () => {
      expect(validateStep(9, { complexity: 'media', confirmed: true }).ok).toBe(true);
      expect(validateStep(9, { complexity: 'altíssima', confirmed: true }).ok).toBe(
        false,
      );
    });

    /**
     * A tela e o domain têm de listar o MESMO conjunto: opção que existe só no
     * `steps.ts` da web é oferecida ao cliente e recusada com 422 no envio —
     * depois de ele responder as 9 etapas.
     */
    it('etapa 4 aceita os seis tipos de solução, inclusive web + app', () => {
      for (const kind of [
        'site_institucional',
        'landing',
        'ecommerce',
        'sistema_web',
        'app',
        'sistema_web_app',
      ]) {
        expect(validateStep(4, { kind }).ok).toBe(true);
      }
      expect(validateStep(4, { kind: 'sistema_desktop' }).ok).toBe(false);
    });

    it('etapa 9 NUNCA aceita nome de modelo de IA', () => {
      // Critério de aceite literal da spec: nenhum nome de modelo aparece na
      // tela nem na resposta da API. O nível é baixa/média/alta e nada mais.
      const out = validateStep(9, { complexity: 'claude-sonnet-5', confirmed: true });
      expect(out.ok).toBe(false);
    });

    it('etapa desconhecida é recusada, não ignorada', () => {
      expect(validateStep(42, {}).ok).toBe(false);
    });

    it('campo desconhecido na etapa é recusado', () => {
      // Payload não é depósito: aceitar chave arbitrária deixaria o cliente
      // gravar o que quisesse no jsonb que alimenta o pipeline.
      expect(validateStep(1, { company: 'A', segment: 'J', hack: 'x' }).ok).toBe(
        false,
      );
    });

    it('recusa `workspaceId`/`tenantId` no payload', () => {
      // Critério de isolamento da spec: nenhum payload público aceita tenant.
      expect(
        validateStep(1, { company: 'A', segment: 'J', tenantId: 't1' }).ok,
      ).toBe(false);
    });
  });

  describe('mergeAnswers', () => {
    it('substitui só a etapa salva e preserva as demais', () => {
      const antes = { 1: { company: 'ACME' }, 4: { kind: 'landing' } };
      const depois = mergeAnswers(antes, 1, { company: 'ACME 2', segment: 'J' });

      expect(depois[1]).toEqual({ company: 'ACME 2', segment: 'J' });
      expect(depois[4]).toEqual({ kind: 'landing' });
    });

    it('não muta o objeto original', () => {
      const antes = { 1: { company: 'ACME' } };
      mergeAnswers(antes, 1, { company: 'outro' });
      expect(antes[1]).toEqual({ company: 'ACME' });
    });
  });

  describe('completedStepCount — o progresso que o painel mostra', () => {
    it('conta só as etapas válidas', () => {
      const answers = {
        1: { company: 'ACME', segment: 'J' },
        2: { problem: 'x', expected: 'y', success: 'z' },
        4: {}, // obrigatória e vazia: não conta
      };
      expect(completedStepCount(answers)).toBe(2);
    });

    it('etapa opcional respondida conta como concluída', () => {
      expect(completedStepCount({ 3: { audience: 'PMEs' } })).toBe(1);
    });

    it('rascunho vazio tem zero etapas concluídas', () => {
      expect(completedStepCount({})).toBe(0);
    });
  });

  describe('validateAllSteps — a barreira do submit', () => {
    const completo = {
      1: { company: 'ACME', segment: 'J' },
      2: { problem: 'p', expected: 'e', success: 's' },
      4: { kind: 'landing' },
      9: { complexity: 'media', confirmed: true },
    };

    it('aceita quando todas as obrigatórias estão preenchidas', () => {
      expect(validateAllSteps(completo).ok).toBe(true);
    });

    it('recusa quando falta uma obrigatória', () => {
      const { 4: _semEtapa4, ...faltando } = completo;
      const out = validateAllSteps(faltando);
      expect(out.ok).toBe(false);
      expect(out.errors.some((e) => e.step === 4)).toBe(true);
    });

    it('recusa sem a confirmação explícita da etapa 9', () => {
      // "depois do envio nada pode ser alterado" — o aceite disso é a
      // confirmação, então submeter sem ela não pode passar.
      const out = validateAllSteps({
        ...completo,
        9: { complexity: 'media', confirmed: false },
      });
      expect(out.ok).toBe(false);
    });
  });
});
