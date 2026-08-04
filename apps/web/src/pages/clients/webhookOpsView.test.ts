import { describe, expect, it } from 'vitest';
import {
  produtoDoErro,
  canDiscard,
  canReopen,
  canReprocess,
  discardNote,
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
    discardedAt: null,
    discardedBy: null,
    discardedReason: null,
    reopenedAt: null,
    ...over,
  };
}

/** Uma entrega descartada, com o carimbo completo (SPEC-045). */
function descartada(over: Partial<WebhookEventView> = {}): WebhookEventView {
  return evento({
    status: 'DISCARDED',
    error: 'Oferta sem mapeamento: produto 764cd7eb',
    licenseId: null,
    discardedAt: '2026-08-04T10:00:00.000Z',
    discardedBy: 'rodrigo',
    discardedReason: 'disparo do botão Testar Webhook',
    ...over,
  });
}

describe('webhookStatusLabel / webhookStatusTone', () => {
  it('nomeia os cinco estados em português', () => {
    expect(webhookStatusLabel('PENDING')).toBe('Aguardando');
    expect(webhookStatusLabel('PROCESSED')).toBe('Processada');
    expect(webhookStatusLabel('FAILED')).toBe('Falhou');
    expect(webhookStatusLabel('IGNORED')).toBe('Ignorada');
    // "Descartada" ≠ "Ignorada": `IGNORED` é a máquina dizendo que o tipo não
    // lhe diz respeito; `DISCARDED` é uma pessoa dizendo que a entrega não vai
    // virar nada. Rótulos iguais apagariam a pergunta *quem*.
    expect(webhookStatusLabel('DISCARDED')).toBe('Descartada');
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

  /**
   * **Reprocessar não ressuscita** (SPEC-045). O caminho de volta é o *Reabrir*,
   * com carimbo próprio — dois atos deliberados, simétrico ao
   * Finalizado/Descartado do board.
   */
  it('NÃO oferece reprocessar o que foi descartado', () => {
    expect(canReprocess(descartada())).toBe(false);
  });

  it('oferece para PENDING (entrega presa numa fila que morreu)', () => {
    expect(canReprocess(evento({ status: 'PENDING' }))).toBe(true);
  });
});

describe('canDiscard / canReopen', () => {
  it('descartar é oferecido no que falhou — o caso que originou a fatia', () => {
    expect(canDiscard(evento({ status: 'FAILED' }))).toBe(true);
    expect(canDiscard(evento({ status: 'PENDING' }))).toBe(true);
    expect(canDiscard(evento({ status: 'IGNORED' }))).toBe(true);
  });

  /**
   * A entrega que virou licença é o elo entre a venda e a chave emitida:
   * escondê-la quebraria a pergunta "de onde veio esta licença".
   */
  it('NÃO oferece descartar o que já virou licença', () => {
    expect(canDiscard(evento({ status: 'PROCESSED' }))).toBe(false);
  });

  it('NÃO oferece descartar o que já está descartado', () => {
    expect(canDiscard(descartada())).toBe(false);
  });

  it('reabrir aparece só na linha descartada — é o único caminho de volta', () => {
    expect(canReopen(descartada())).toBe(true);
    for (const status of ['FAILED', 'PENDING', 'PROCESSED', 'IGNORED'] as const) {
      expect(canReopen(evento({ status }))).toBe(false);
    }
  });
});

describe('discardNote', () => {
  it('diz o motivo e quem descartou — a trilha que o descarte existe para manter', () => {
    expect(discardNote(descartada())).toBe(
      'disparo do botão Testar Webhook — descartada por rodrigo',
    );
  });

  it('não inventa carimbo em entrega que não foi descartada', () => {
    expect(discardNote(evento({ status: 'FAILED' }))).toBeNull();
  });

  /**
   * O CHECK do banco impede motivo vazio, mas a tela lê dados que já existiam.
   * "sem motivo registrado" é informação real; um campo em branco pareceria bug.
   */
  it('diz que falta o motivo em vez de mostrar vazio', () => {
    expect(discardNote(descartada({ discardedReason: '  ' }))).toBe(
      'sem motivo registrado — descartada por rodrigo',
    );
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

/**
 * O id do produto dentro da mensagem de falha (FIX do dogfooding, 2026-07-31).
 *
 * Esse era o **único lugar** onde o operador via o id, para transcrevê-lo à mão
 * noutra aba. Extraí-lo é o que permite oferecer o mapeamento na própria linha
 * que falhou.
 */
describe('produtoDoErro', () => {
  it('extrai o produto da mensagem que o servidor grava', () => {
    const erro = 'Oferta sem mapeamento: produto 2567aaf0-f9d7-4ca0, oferta (nenhuma)';

    expect(produtoDoErro(erro)).toBe('2567aaf0-f9d7-4ca0');
  });

  it('extrai também quando há id de oferta', () => {
    const erro = 'Oferta sem mapeamento: produto prod-1, oferta of-9';

    expect(produtoDoErro(erro)).toBe('prod-1');
  });

  it('outro erro não vira oferta de mapeamento', () => {
    // Licença não encontrada não tem o que mapear; oferecer o seletor ali
    // sugeriria que o problema é de-para quando não é.
    expect(produtoDoErro('Licença não encontrada para a assinatura sub-1')).toBeNull();
    expect(produtoDoErro('Assinatura inválida')).toBeNull();
  });

  it('sem erro, nada', () => {
    expect(produtoDoErro(null)).toBeNull();
    expect(produtoDoErro('')).toBeNull();
  });
});
