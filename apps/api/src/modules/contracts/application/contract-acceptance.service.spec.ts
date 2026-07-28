import type { ClientsService } from '../../clients/application/clients.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { ContractAcceptanceService } from './contract-acceptance.service';

const CONTRATO = {
  id: 'ctr-1',
  tenantId: 't-1',
  clientProjectId: 'cp-1',
  version: 1,
  acceptedAt: null as Date | null,
  acceptedBy: null as string | null,
};

function montar(
  opcoes: {
    contrato?: typeof CONTRATO | null;
    transitionThrows?: Error;
  } = {},
) {
  const gravado: Array<Record<string, unknown>> = [];
  const auditados: Array<Record<string, unknown>> = [];
  const linha =
    opcoes.contrato === undefined ? { ...CONTRATO } : opcoes.contrato;

  const prisma = {
    contract: {
      findFirst: jest.fn(async () => linha),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        gravado.push(data);
        return { ...linha, ...data };
      }),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditados.push(data);
        return data;
      }),
    },
  } as unknown as PrismaService;

  const clients = {
    transition: jest.fn(async () => {
      if (opcoes.transitionThrows) throw opcoes.transitionThrows;
      return { id: 'cp-1', state: 'CONTRACT_APPROVED' };
    }),
  } as unknown as ClientsService;

  return {
    service: new ContractAcceptanceService(prisma, clients),
    clients,
    gravado,
    auditados,
  };
}

describe('ContractAcceptanceService: o ator nunca é nulo (§2.10)', () => {
  /**
   * O critério de aceite é literal: ator **nunca nulo**. Um contrato "aceito
   * por ninguém" é exatamente o fechamento frágil que este produto existe para
   * detectar — e o `ClientStatusTransition.actorUserId` é nullable por causa
   * das transições do sistema (1º save do rascunho), então a barreira precisa
   * estar aqui, não no schema da trilha.
   */
  it.each([null, undefined, ''])(
    'recusa aceite com ator %p, sem gravar nada',
    async (ator) => {
      const { service, gravado, clients } = montar();

      await expect(
        service.accept('t-1', 'ctr-1', { channel: 'email' }, ator as string),
      ).rejects.toThrow(/ator/i);

      expect(gravado).toHaveLength(0);
      expect(clients.transition).not.toHaveBeenCalled();
    },
  );

  it('grava o ator que registrou o aceite', async () => {
    const { service, gravado } = montar();
    await service.accept('t-1', 'ctr-1', { channel: 'email' }, 'u-1');

    expect(gravado[0]).toMatchObject({ acceptedBy: 'u-1' });
    expect(gravado[0].acceptedAt).toBeInstanceOf(Date);
  });
});

describe('ContractAcceptanceService: canal de lista fechada (§2.10, decisão 3)', () => {
  it.each(['email', 'whatsapp', 'presencial', 'telefone'] as const)(
    'aceita o canal %s',
    async (channel) => {
      const { service, gravado } = montar();
      await service.accept('t-1', 'ctr-1', { channel }, 'u-1');
      expect(gravado[0]).toMatchObject({ acceptanceChannel: channel });
    },
  );

  it.each(['carta', 'pombo', 'EMAIL', 'e-mail', '', null, undefined])(
    'recusa o canal %p com motivo legível',
    async (channel) => {
      const { service, gravado } = montar();

      await expect(
        service.accept('t-1', 'ctr-1', { channel: channel as 'email' }, 'u-1'),
      ).rejects.toThrow(/canal/i);
      expect(gravado).toHaveLength(0);
    },
  );

  it('a mensagem de recusa nomeia os canais válidos', async () => {
    const { service } = montar();
    await expect(
      service.accept('t-1', 'ctr-1', { channel: 'carta' as 'email' }, 'u-1'),
    ).rejects.toThrow(/email.*whatsapp.*presencial.*telefone/i);
  });
});

describe('ContractAcceptanceService: a observação é livre e opcional', () => {
  it('aceita sem observação', async () => {
    const { service, gravado } = montar();
    await service.accept('t-1', 'ctr-1', { channel: 'email' }, 'u-1');
    expect(gravado[0].acceptanceNote).toBeNull();
  });

  it('grava a observação quando existe', async () => {
    const { service, gravado } = montar();
    await service.accept(
      't-1',
      'ctr-1',
      { channel: 'presencial', note: 'assinado na reunião de 28/07' },
      'u-1',
    );
    expect(gravado[0]).toMatchObject({
      acceptanceNote: 'assinado na reunião de 28/07',
    });
  });

  it('observação em branco vira nulo, não string vazia', async () => {
    const { service, gravado } = montar();
    await service.accept(
      't-1',
      'ctr-1',
      { channel: 'email', note: '   ' },
      'u-1',
    );
    expect(gravado[0].acceptanceNote).toBeNull();
  });
});

describe('ContractAcceptanceService: é o aceite que move o card (§2.6)', () => {
  it('pede a transição CONTRACT_PENDING → CONTRACT_APPROVED', async () => {
    const { service, clients } = montar();
    await service.accept('t-1', 'ctr-1', { channel: 'email' }, 'u-1');

    expect(clients.transition).toHaveBeenCalledWith(
      't-1',
      'cp-1',
      { to: 'CONTRACT_APPROVED' },
      'u-1',
    );
  });

  /**
   * A transição passa pelo `ClientsService`, nunca por escrita direta: a
   * máquina de estados vive no `domain/` do `clients` (ADR-001), e o
   * `contracts-boundaries.arch.spec.ts` prova que nenhuma escrita em tabela
   * alheia sai deste módulo.
   */
  it('o ator da transição é o mesmo que registrou o aceite', async () => {
    const { service, clients } = montar();
    await service.accept('t-1', 'ctr-1', { channel: 'whatsapp' }, 'u-9');

    expect(clients.transition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'u-9',
    );
  });

  /**
   * Mesmo desenho do `EstimatesService.approve` e do `ArtifactReviewService`: a
   * transição pode ser recusada pela máquina de estados (card já adiante, por
   * exemplo), e isso NÃO pode desfazer o aceite — que já está gravado e é o ato
   * que a pessoa pediu.
   */
  it('transição recusada não desfaz o aceite já gravado', async () => {
    const { service, gravado } = montar({
      transitionThrows: new Error('transição inválida'),
    });

    const r = await service.accept('t-1', 'ctr-1', { channel: 'email' }, 'u-1');

    expect(gravado).toHaveLength(1);
    expect(r).toMatchObject({ accepted: true, cardMoved: false });
  });

  it('informa que o card moveu quando a transição passa', async () => {
    const { service } = montar();
    const r = await service.accept('t-1', 'ctr-1', { channel: 'email' }, 'u-1');
    expect(r).toMatchObject({ accepted: true, cardMoved: true });
  });
});

describe('ContractAcceptanceService: aceitar duas vezes', () => {
  /**
   * Idempotente e não erro: dois cliques no mesmo botão não são um problema a
   * reportar. O que não pode é o segundo mover o card de novo — nem sobrescrever
   * a data e o ator do aceite que realmente aconteceu.
   */
  it('o segundo aceite não regrava nem move o card', async () => {
    const { service, gravado, clients } = montar({
      contrato: {
        ...CONTRATO,
        acceptedAt: new Date('2026-07-28T10:00:00Z'),
        acceptedBy: 'u-1',
      },
    });

    const r = await service.accept('t-1', 'ctr-1', { channel: 'email' }, 'u-2');

    expect(r).toMatchObject({ accepted: true, cardMoved: false, alreadyAccepted: true });
    expect(gravado).toHaveLength(0);
    expect(clients.transition).not.toHaveBeenCalled();
  });
});

describe('ContractAcceptanceService: contrato alheio', () => {
  it('recusa sem dizer que o contrato existe', async () => {
    const { service, gravado, clients } = montar({ contrato: null });

    await expect(
      service.accept('t-1', 'ctr-alheio', { channel: 'email' }, 'u-1'),
    ).rejects.toThrow(/não encontrado/);

    expect(gravado).toHaveLength(0);
    expect(clients.transition).not.toHaveBeenCalled();
  });
});

describe('ContractAcceptanceService: trilha', () => {
  it('audita o aceite com canal e ator', async () => {
    const { service, auditados } = montar();
    await service.accept('t-1', 'ctr-1', { channel: 'telefone' }, 'u-1');

    const evento = auditados.find((a) => a.kind === 'contract.accepted');
    expect(evento).toMatchObject({
      tenantId: 't-1',
      subject: 'ctr-1',
      payload: expect.objectContaining({ channel: 'telefone', acceptedBy: 'u-1' }),
    });
  });

  /**
   * §8.4: o link continua válido até expirar — o cliente relê o que aceitou.
   * Provado por AUSÊNCIA: nada neste service toca `contractLink`.
   */
  it('não revoga o link ao aceitar', async () => {
    const { service } = montar();
    const r = await service.accept('t-1', 'ctr-1', { channel: 'email' }, 'u-1');
    expect(r).not.toHaveProperty('linkRevoked');
  });
});
