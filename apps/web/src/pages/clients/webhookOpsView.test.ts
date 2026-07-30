import { describe, expect, it } from 'vitest';
import {
  canReprocess,
  offerLabel,
  pendingCount,
  toleranceLabel,
  webhookErrorText,
  webhookStatusLabel,
  webhookStatusTone,
} from './webhookOpsView';
import type { OfferMappingView, WebhookEventView } from '../../lib/api';

function evento(over: Partial<WebhookEventView> = {}): WebhookEventView {
  return {
    id: 'ev-1',
    platform: 'kiwify',
    eventType: 'order_approved',
    externalEventId: 'ord_1:order_approved',
    status: 'PROCESSED',
    error: null,
    receivedAt: '2026-07-29T12:00:00.000Z',
    processedAt: '2026-07-29T12:00:01.000Z',
    licenseId: 'lic-1',
    ...over,
  };
}

describe('webhookStatusLabel / webhookStatusTone', () => {
  it('nomeia os quatro estados em português', () => {
    expect(webhookStatusLabel('PENDING')).toBe('Aguardando');
    expect(webhookStatusLabel('PROCESSED')).toBe('Processada');
    expect(webhookStatusLabel('FAILED')).toBe('Falhou');
    expect(webhookStatusLabel('IGNORED')).toBe('Ignorada');
  });

  /**
   * `IGNORED` neutro é a decisão que evita caça a problema inexistente: a
   * plataforma manda tipos que não nos interessam (`pix_created`), e isso é
   * resultado normal.
   */
  it('só FAILED pede alerta — IGNORED é neutro', () => {
    expect(webhookStatusTone('PROCESSED')).toBe('ok');
    expect(webhookStatusTone('FAILED')).toBe('alert');
    expect(webhookStatusTone('IGNORED')).toBe('muted');
    expect(webhookStatusTone('PENDING')).toBe('muted');
  });
});

describe('canReprocess', () => {
  /**
   * A idempotência do PR-3 mora no UNIQUE do recebimento, não do processamento.
   * Um botão que sempre devolve 422 ensina a ignorar erro.
   */
  it('não oferece reprocessar o que já foi processado', () => {
    expect(canReprocess(evento({ status: 'PROCESSED' }))).toBe(false);
  });

  it('oferece para FAILED — o caso que a tela existe para resolver', () => {
    expect(canReprocess(evento({ status: 'FAILED' }))).toBe(true);
  });

  /** Tipo que passe a ser suportado numa versão nova é o caso de uso real. */
  it('oferece para IGNORED', () => {
    expect(canReprocess(evento({ status: 'IGNORED' }))).toBe(true);
  });

  it('oferece para PENDING (entrega presa numa fila que morreu)', () => {
    expect(canReprocess(evento({ status: 'PENDING' }))).toBe(true);
  });
});

describe('webhookErrorText', () => {
  it('mostra a mensagem do servidor', () => {
    expect(
      webhookErrorText(evento({ status: 'FAILED', error: 'Oferta xyz sem mapeamento' })),
    ).toBe('Oferta xyz sem mapeamento');
  });

  /** "Falhou sem mensagem" é fato (e defeito nosso); "erro desconhecido" soaria normal. */
  it('diz que falhou sem mensagem quando o erro está vazio', () => {
    expect(webhookErrorText(evento({ status: 'FAILED', error: '   ' }))).toBe(
      'Falhou sem mensagem registrada',
    );
    expect(webhookErrorText(evento({ status: 'FAILED', error: null }))).toBe(
      'Falhou sem mensagem registrada',
    );
  });

  it('não inventa erro para quem não falhou', () => {
    expect(webhookErrorText(evento({ status: 'PROCESSED', error: 'resíduo' }))).toBeNull();
    expect(webhookErrorText(evento({ status: 'IGNORED' }))).toBeNull();
  });
});

describe('offerLabel', () => {
  function mapeamento(offerId: string | null): OfferMappingView {
    return {
      id: 'map-1',
      platform: 'kiwify',
      externalProductId: 'prod-1',
      externalOfferId: offerId,
      editionId: 'edi-1',
      createdAt: '2026-07-29T12:00:00.000Z',
      edition: { id: 'edi-1', slug: 'closed', name: 'Sem código-fonte' },
    };
  }

  it('mostra a oferta quando específica', () => {
    expect(offerLabel(mapeamento('offer-anual'))).toBe('offer-anual');
  });

  /** `—` faria o caso mais importante parecer campo em branco. */
  it('diz curinga por extenso quando nulo', () => {
    expect(offerLabel(mapeamento(null))).toBe('qualquer oferta (curinga)');
  });
});

describe('toleranceLabel', () => {
  /**
   * O caso que a tela não pode errar: `null` é a decisão PI #3, não "não
   * configurado". Um `—` levaria alguém a "consertar" configurando — e a ligar
   * um corte que o dono desligou de propósito.
   */
  it('null diz que o ProPlan nunca corta, não que está vazio', () => {
    const texto = toleranceLabel(null);
    expect(texto).toContain('nunca corta');
    expect(texto).toContain('plataforma');
    expect(texto).not.toContain('0');
  });

  it('zero é diferente de null: corta no aviso', () => {
    expect(toleranceLabel(0)).toBe('Corta assim que a plataforma avisa o atraso');
  });

  it('concorda o plural', () => {
    expect(toleranceLabel(1)).toContain('1 dia ');
    expect(toleranceLabel(15)).toContain('15 dias');
  });
});

describe('pendingCount', () => {
  /** `PENDING` está no caminho normal — o job vai pegar. Só `FAILED` pede ação. */
  it('conta só o que pede ação', () => {
    expect(
      pendingCount([
        evento({ status: 'FAILED' }),
        evento({ status: 'PENDING' }),
        evento({ status: 'PROCESSED' }),
        evento({ status: 'IGNORED' }),
        evento({ status: 'FAILED' }),
      ]),
    ).toBe(2);
  });

  it('zero em lista vazia', () => {
    expect(pendingCount([])).toBe(0);
  });
});
