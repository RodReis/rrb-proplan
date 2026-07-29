import { describe, expect, it } from 'vitest';
import type { PendingItem } from '../../lib/api';
import {
  PERIOD_OPTIONS,
  activityText,
  contractsSummary,
  haQuantoTempo,
  pendingHref,
  repoFailureText,
  repoTally,
} from './dashboardView';

function item(over: Partial<PendingItem> = {}): PendingItem {
  return {
    kind: 'artifact_review',
    clientId: 'c1',
    clientProjectId: 'p1',
    title: 'Loja nova',
    detail: 'Artefato SCOPE aguardando revisão',
    target: 'artefatos',
    since: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('dashboardView (SPEC-035)', () => {
  describe('período: lista fechada de 4 (§2.8)', () => {
    it('são exatamente os 4 da spec, na ordem', () => {
      expect(PERIOD_OPTIONS.map((p) => p.value)).toEqual([
        '7',
        '30',
        '90',
        'current_month',
      ]);
    });
  });

  describe('drill-down: link ou texto, nunca link morto (§7.3)', () => {
    it('item com destino vira URL com cliente, projeto e painel', () => {
      expect(pendingHref(item(), 'rodreisb')).toBe(
        '/t/rodreisb/clients?cliente=c1&projeto=p1&painel=artefatos',
      );
    });

    it('cada painel produz o seu destino', () => {
      expect(pendingHref(item({ target: 'estimativa' }), 't')).toContain(
        'painel=estimativa',
      );
      expect(pendingHref(item({ target: 'contratos' }), 't')).toContain(
        'painel=contratos',
      );
    });

    it('item SEM destino devolve `null` — a tela renderiza texto', () => {
      // Um link que leva a 404 ensina a pessoa a desconfiar de todos os outros.
      // Quem decide se há destino é o servidor, no `target`.
      expect(pendingHref(item({ kind: 'stalled', target: null }), 't')).toBeNull();
    });

    it('escapa o que precisa ser escapado na query', () => {
      const href = pendingHref(item({ clientId: 'a b&c' }), 't');
      expect(href).toContain('cliente=a+b%26c');
    });
  });

  describe('zero é resultado; ausência é outra coisa (§2.7, §5)', () => {
    it('quem NUNCA emitiu lê outra frase, não "0"', () => {
      // É o defeito mais provável desta tela: `COUNT(*)` devolve 0 para "usei e
      // deu zero" e para "nunca usei", e colapsá-los faz o 2º parecer o 1º.
      expect(contractsSummary({ issued: 0, accepted: 0, hasAny: false })).toEqual({
        kind: 'never',
        text: 'Você ainda não emitiu contrato',
      });
    });

    it('quem emitiu e teve zero NO PERÍODO lê um resultado', () => {
      expect(contractsSummary({ issued: 0, accepted: 0, hasAny: true })).toEqual({
        kind: 'zero',
        text: 'Nenhum contrato emitido no período',
      });
    });

    it('as duas frases são DIFERENTES — é o critério de aceite literal', () => {
      const nunca = contractsSummary({ issued: 0, accepted: 0, hasAny: false });
      const zero = contractsSummary({ issued: 0, accepted: 0, hasAny: true });

      expect(nunca.text).not.toBe(zero.text);
      expect(nunca.kind).not.toBe(zero.kind);
    });

    it('com contratos, mostra emitidos e aceitos', () => {
      expect(contractsSummary({ issued: 3, accepted: 1, hasAny: true }).text).toBe(
        '3 emitidos · 1 com aceite',
      );
      expect(contractsSummary({ issued: 1, accepted: 0, hasAny: true }).text).toBe(
        '1 emitido · 0 com aceite',
      );
    });
  });

  describe('falha de repo: as três razões têm texto próprio (§2.11)', () => {
    it('rate limit diz que é limite E quando volta', () => {
      // O §2.11 é literal: nunca zero silencioso, que seria indistinguível de
      // board vazio.
      const texto = repoFailureText('rate_limit', '2026-08-15T16:30:00.000Z');

      expect(texto).toContain('Limite do GitHub');
      expect(texto).toMatch(/\d{2}:\d{2}/);
    });

    it('rate limit SEM horário não inventa um', () => {
      // Horário falso é pior que a ausência dele: a pessoa volta, falha de novo,
      // e passa a desconfiar da mensagem inteira.
      const texto = repoFailureText('rate_limit', null);

      expect(texto).toContain('Limite do GitHub');
      expect(texto).not.toMatch(/\d{2}:\d{2}/);
    });

    it('timeout e erro têm textos próprios, e nenhum menciona zero', () => {
      expect(repoFailureText('timeout', null)).toContain('demorou');
      expect(repoFailureText('error', null)).toContain('Não foi possível');
      for (const r of ['rate_limit', 'timeout', 'error'] as const) {
        expect(repoFailureText(r, null)).not.toContain('0 ');
      }
    });

    it('horário ilegível vira travessão, não "Invalid Date"', () => {
      expect(repoFailureText('rate_limit', 'nao-e-data')).toContain('—');
    });
  });

  describe('há quanto tempo espera', () => {
    const AGORA = new Date('2026-08-15T12:00:00.000Z');

    it('conta os dias', () => {
      expect(haQuantoTempo('2026-08-15T09:00:00.000Z', AGORA)).toBe('hoje');
      expect(haQuantoTempo('2026-08-14T09:00:00.000Z', AGORA)).toBe('há 1 dia');
      expect(haQuantoTempo('2026-07-16T12:00:00.000Z', AGORA)).toBe('há 30 dias');
    });

    it('data futura não vira número negativo', () => {
      expect(haQuantoTempo('2026-09-01T00:00:00.000Z', AGORA)).toBe('hoje');
    });

    it('data ilegível some, em vez de mostrar NaN', () => {
      expect(haQuantoTempo('sei lá', AGORA)).toBe('');
    });
  });

  describe('a trilha em português, sem UUID (achado no dogfooding)', () => {
    it('traduz o tipo do evento e DESCARTA o identificador da linha', () => {
      // A tela mostrava `contract_link.accessed: 2d638f14-eeb9-…` repetido
      // quatro vezes. O nome do evento é o fato; o UUID é o id da linha, que
      // não ajuda ninguém a lembrar o que estava fazendo.
      const texto = activityText({
        kind: 'audit',
        at: '2026-07-28T12:00:00.000Z',
        title: '',
        detail: 'contract_link.accessed: 2d638f14-eeb9-4a2d-80f4-35c59770e35a',
        clientProjectId: null,
      });

      expect(texto).toBe('Contrato aberto pelo cliente');
      expect(texto).not.toContain('2d638f14');
    });

    it('tipo NOVO cai no próprio nome — não some da lista', () => {
      // Sumir seria pior: o bloco existe para dizer o que andou, e uma trilha
      // que omite o que não reconhece mente por omissão.
      const texto = activityText({
        kind: 'audit',
        at: '2026-07-28T12:00:00.000Z',
        title: '',
        detail: 'fatia.futura: abc-123',
        clientProjectId: null,
      });

      expect(texto).toBe('fatia.futura');
    });

    it('funil e sync passam intactos — o detalhe deles já é legível', () => {
      expect(
        activityText({
          kind: 'funnel',
          at: 'x',
          title: 'Projeto EPG2',
          detail: 'CONTRACT_PENDING → CONTRACT_APPROVED',
          clientProjectId: 'p1',
        }),
      ).toBe('CONTRACT_PENDING → CONTRACT_APPROVED');

      expect(
        activityText({
          kind: 'sync',
          at: 'x',
          title: '',
          detail: 'RodReis/rrb-proplan: +2 ~1 -0',
          clientProjectId: 'p1',
        }),
      ).toBe('RodReis/rrb-proplan: +2 ~1 -0');
    });
  });

  describe('contagem de repos NÃO cruza os domínios (ADR-023, §2.4)', () => {
    it('conta só os repos, e separa ok de falho', () => {
      const tally = repoTally([
        { status: 'ok', projectId: 'p1', repo: 'a/b', columns: [] },
        { status: 'failed', projectId: 'p2', repo: 'c/d', reason: 'error', retryAt: null },
        { status: 'ok', projectId: 'p3', repo: 'e/f', columns: [] },
      ]);

      expect(tally).toEqual({ ok: 2, failed: 1 });
    });

    it('não expõe nenhum total agregado — auditável por ausência', () => {
      const tally = repoTally([]);

      expect(Object.keys(tally).sort()).toEqual(['failed', 'ok']);
      expect(tally).not.toHaveProperty('total');
    });
  });
});
