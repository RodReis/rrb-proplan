import { describe, expect, it } from 'vitest';
import type { SourcePendingItem } from '../../lib/api';
import {
  actionableCount,
  canReinvite,
  canRemoveAccess,
  nextActionText,
  patStatusText,
  reasonLabel,
  reasonTone,
  reconcileSummary,
  removalOutcomeText,
} from './sourceOpsView';

/**
 * Apresentação do acesso ao source (SPEC-039 PR-5).
 *
 * O que estes testes protegem é **o que a tela afirma**. A spec é explícita
 * (§Objetivo): *"painel que sugira 'acesso revogado = código recuperado' mente para
 * o operador"* — remover o colaborador não recupera o que já foi clonado, o que
 * acaba são os updates. Um texto errado aqui é uma afirmação falsa na tela, que é
 * pior que um botão quebrado: o operador confia nela e não confere.
 */

function item(over: Partial<SourcePendingItem> = {}): SourcePendingItem {
  return {
    licenseId: 'lic-1',
    customerEmail: 'comprador@exemplo.com',
    customerName: 'Mario',
    editionName: 'Completa com código-fonte',
    sourceAccess: 'PENDING',
    githubUsername: null,
    sourceInviteAt: '2026-07-20T12:00:00.000Z',
    sourceAccessError: null,
    reason: 'awaiting_username',
    ...over,
  };
}

describe('motivo da pendência', () => {
  it.each([
    ['awaiting_username', 'Aguardando o comprador'],
    ['invited_not_accepted', 'Convite não aceito'],
    ['failed', 'Falhou'],
  ] as const)('%s → "%s"', (reason, esperado) => {
    expect(reasonLabel(reason)).toBe(esperado);
  });

  it('só `failed` é alerta', () => {
    // "Aguardando o comprador" e "convite não aceito" são o processo andando — o
    // comprador não leu o e-mail, ou não clicou no convite do GitHub. Pintá-los de
    // vermelho faria o operador caçar defeito onde só falta gente responder, e o
    // `FAILED` de verdade (PAT expirado) se perderia no meio.
    expect(reasonTone('failed')).toBe('alert');
    expect(reasonTone('awaiting_username')).toBe('muted');
    expect(reasonTone('invited_not_accepted')).toBe('muted');
  });

  it('cada motivo diz uma AÇÃO diferente', () => {
    const textos = (['awaiting_username', 'invited_not_accepted', 'failed'] as const).map(
      (reason) => nextActionText(item({ reason })),
    );

    // Sem isto o operador olha um enum e adivinha. Três motivos, três frases —
    // repetir a mesma seria o mesmo que não dizer nada.
    expect(new Set(textos).size).toBe(3);
    expect(textos[0]).toMatch(/uso único/);
    expect(textos[2]).toMatch(/reemita/);
  });
});

describe('quais botões aparecem', () => {
  it('reemitir só em `failed` COM username', () => {
    expect(canReinvite(item({ reason: 'failed', githubUsername: 'rod' }))).toBe(true);
    // Sem username o servidor recusa com 422 — um botão que sempre falha ensina a
    // ignorar erro.
    expect(canReinvite(item({ reason: 'failed', githubUsername: null }))).toBe(false);
  });

  it('reemitir NÃO aparece em "convite não aceito"', () => {
    // O convite já está de pé, e "reemitir" não o reenvia: a rodada não acha a
    // licença, que não está em `PENDING`. Um botão que não faz nada é pior que a
    // ausência dele.
    expect(
      canReinvite(item({ reason: 'invited_not_accepted', githubUsername: 'rod' })),
    ).toBe(false);
  });

  it('remover acesso só onde existe acesso', () => {
    expect(canRemoveAccess(item({ sourceAccess: 'INVITED' }))).toBe(true);
    expect(canRemoveAccess(item({ sourceAccess: 'ACTIVE' }))).toBe(true);
    // Oferecer "remover acesso" sem convite emitido sugeriria que há algo a
    // revogar — e quem clicasse sairia com a impressão de ter revogado.
    expect(canRemoveAccess(item({ sourceAccess: 'PENDING' }))).toBe(false);
    expect(canRemoveAccess(item({ sourceAccess: 'REMOVED' }))).toBe(false);
    expect(canRemoveAccess(item({ sourceAccess: 'FAILED' }))).toBe(false);
  });
});

describe('o que a remoção afirma', () => {
  it('colaborador removido NÃO promete recuperação do código', () => {
    const texto = removalOutcomeText('collaborator_removed');

    // **A regra do §Objetivo.** O que a remoção entrega é o fim dos updates; o
    // clone permanece, e o mecanismo é contratual (§8 do MVP4). Um "acesso
    // revogado" seco seria lido como "o código voltou".
    expect(texto).toMatch(/updates/);
    expect(texto).toMatch(/já foi clonado continua/);
    expect(texto).toMatch(/contratual/);
  });

  it('convite cancelado diz que ninguém entrou', () => {
    // Aqui, ao contrário, nada foi clonado — e dizer isso é o que distingue os dois
    // desfechos para quem vai explicar ao cliente.
    expect(removalOutcomeText('invitation_canceled')).toMatch(/não chegou a entrar/);
  });

  it('`failed` diz que o acesso CONTINUA de pé', () => {
    const texto = removalOutcomeText('failed');

    // Sucesso HTTP com fracasso real. Dizer "removido" aqui seria o fechamento
    // frágil que este produto existe para detectar.
    expect(texto).toMatch(/CONTINUA/);
    expect(texto).not.toMatch(/removido com sucesso/);
  });

  it('`nothing_to_do` não inventa uma remoção', () => {
    expect(removalOutcomeText('nothing_to_do')).toMatch(/Não havia acesso/);
  });
});

describe('resumo da rodada', () => {
  it('fala de TODAS as licenças, não da que originou o clique', () => {
    const texto = reconcileSummary({
      convidados: 2,
      aceitos: 1,
      falhas: 1,
      aguardandoUsername: 3,
    });

    // Reemitir dispara a reconciliação do tenant. "Convite reemitido" esconderia
    // que outras licenças também foram convidadas.
    expect(texto).toMatch(/2 convidado/);
    expect(texto).toMatch(/1 aceito/);
    expect(texto).toMatch(/1 falha/);
    expect(texto).toMatch(/3 sem username/);
  });

  it('rodada vazia é dita com clareza', () => {
    // O desfecho mais confuso: a ação "funcionou" e nada mudou. Um resumo vazio
    // pareceria sucesso silencioso.
    expect(
      reconcileSummary({ convidados: 0, aceitos: 0, falhas: 0, aguardandoUsername: 0 }),
    ).toBe('A rodada não encontrou nada a fazer.');
  });

  it('omite os zeros em vez de listar "0 falhas"', () => {
    const texto = reconcileSummary({
      convidados: 1,
      aceitos: 0,
      falhas: 0,
      aguardandoUsername: 0,
    });
    expect(texto).toMatch(/1 convidado/);
    expect(texto).not.toMatch(/0 /);
  });
});

describe('contador de pendências', () => {
  it('conta só o que pede ação NOSSA', () => {
    const itens = [
      item({ reason: 'failed' }),
      item({ reason: 'awaiting_username' }),
      item({ reason: 'invited_not_accepted' }),
    ];

    // `invited_not_accepted` depende do comprador clicar no convite — contá-lo
    // faria o contador nunca zerar, e um contador que nunca zera é ignorado.
    expect(actionableCount(itens)).toBe(2);
  });

  it('lista vazia é zero', () => {
    expect(actionableCount([])).toBe(0);
  });
});

describe('estado do PAT', () => {
  it('não configurado diz o EFEITO: nenhum convite sai', () => {
    expect(patStatusText(false, null)).toMatch(/nenhum convite ao repositório sai/);
  });

  it('configurado NÃO afirma que funciona — aponta o teste', () => {
    const texto = patStatusText(true, 'RodReis/war-room');

    // **PAT fine-grained expira** (limite do GitHub). "Configurado" não significa
    // "funciona", e uma tela que dissesse "tudo ok" esconderia justamente a falha
    // que o teste de conexão existe para antecipar.
    expect(texto).toMatch(/RodReis\/war-room/);
    expect(texto).toMatch(/expira/);
    expect(texto).toMatch(/teste de conexão/);
    expect(texto).toMatch(/não é exibido/);
  });

  it('PAT salvo sem repo configurado é dito como pendência', () => {
    // O convite não teria destino. Sem esta frase, o operador veria "PAT salvo" e
    // esperaria convites que nunca sairiam.
    expect(patStatusText(true, null)).toMatch(/nenhum produto tem repositório/);
  });
});
