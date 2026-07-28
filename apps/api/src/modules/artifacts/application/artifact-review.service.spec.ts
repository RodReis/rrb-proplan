import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ClientsService } from '../../clients/application/clients.service';
import { ArtifactReviewService } from './artifact-review.service';

const TENANT = 't-1';
const ATOR = 'u-1';

interface Cenario {
  artifact?: { id: string; clientProjectId: string; state: string } | null;
  /** Quantos artefatos do projeto já estão APPROVED depois da ação. */
  aprovados?: number;
  parent?: { id: string } | null;
  ultimaVersao?: number;
  transitionFalha?: boolean;
}

function montar({
  artifact = { id: 'art-1', clientProjectId: 'cp-1', state: 'PENDING_REVIEW' },
  aprovados = 1,
  parent = { id: 'av-1' },
  ultimaVersao = 1,
  transitionFalha = false,
}: Cenario = {}) {
  const prisma = {
    artifact: {
      findFirst: jest.fn(async () => artifact),
      update: jest.fn(async () => ({})),
      count: jest.fn(async () => aprovados),
    },
    artifactVersion: {
      findFirst: jest.fn(async ({ select }: { select: Record<string, unknown> }) =>
        // O mesmo mock serve às duas chamadas: buscar o pai e achar a última
        // versão. `select.version` distingue qual delas está perguntando.
        select?.version ? { version: ultimaVersao } : parent,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'av-nova',
        version: data.version,
      })),
    },
  } as unknown as PrismaService;

  const clients = {
    transition: jest.fn(async () => {
      if (transitionFalha) throw new Error('transição inválida');
      return {};
    }),
  } as unknown as ClientsService;

  return { service: new ArtifactReviewService(prisma, clients), prisma, clients };
}

describe('ArtifactReviewService.approve: a regra dos 4 (§2.7)', () => {
  it('aprovar 3 de 4 NÃO move o card', async () => {
    // Critério de aceite literal do §5. É a regra que impede o card de avançar
    // com trabalho pela metade.
    const { service, clients } = montar({ aprovados: 3 });

    const out = await service.approve(TENANT, 'art-1', ATOR);

    expect(out.cardMoved).toBe(false);
    expect(clients.transition).not.toHaveBeenCalled();
  });

  it('aprovar o 4º move o card para ARTIFACTS_READY', async () => {
    const { service, clients } = montar({ aprovados: 4 });

    const out = await service.approve(TENANT, 'art-1', ATOR);

    expect(out.cardMoved).toBe(true);
    expect(clients.transition).toHaveBeenCalledWith(
      TENANT,
      'cp-1',
      { to: 'ARTIFACTS_READY' },
      ATOR,
    );
  });

  it('o ator da transição é o usuário, NUNCA nulo', async () => {
    // §5: diferente do briefing, que move o card com ator nulo por ser público.
    // Aqui há uma pessoa decidindo, e a trilha precisa dizer quem.
    const { service, clients } = montar({ aprovados: 4 });

    await service.approve(TENANT, 'art-1', ATOR);

    const [, , , ator] = (clients.transition as jest.Mock).mock.calls[0];
    expect(ator).toBe(ATOR);
    expect(ator).not.toBeNull();
  });

  it('aprovar limpa o motivo de uma rejeição anterior', async () => {
    // Sem isso a tela mostraria "aprovado" ao lado de "rejeitado porque...".
    const { service, prisma } = montar();

    await service.approve(TENANT, 'art-1', ATOR);

    const { data } = (prisma.artifact.update as jest.Mock).mock.calls[0][0];
    expect(data.rejectionReason).toBeNull();
    expect(data.reviewedBy).toBe(ATOR);
  });

  it('falha na transição NÃO desfaz a aprovação', async () => {
    // A aprovação é o ato que a pessoa pediu e já está gravada. A máquina de
    // estados pode recusar (card já adiante), e isso não pode virar erro numa
    // ação que deu certo.
    const { service, prisma } = montar({ aprovados: 4, transitionFalha: true });

    const out = await service.approve(TENANT, 'art-1', ATOR);

    expect(out.state).toBe('APPROVED');
    expect(out.cardMoved).toBe(false);
    expect(prisma.artifact.update).toHaveBeenCalled();
  });

  it('artefato de outro tenant devolve não-encontrado', async () => {
    // §5: mesma resposta que um id inexistente.
    const { service } = montar({ artifact: null });

    await expect(service.approve(TENANT, 'art-alheio', ATOR)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ArtifactReviewService.reject (§5)', () => {
  it('registra o motivo e mantém o card onde está', async () => {
    const { service, prisma, clients } = montar();

    const out = await service.reject(TENANT, 'art-1', ATOR, 'faltou o prazo');

    expect(out.cardMoved).toBe(false);
    expect(clients.transition).not.toHaveBeenCalled();
    const { data } = (prisma.artifact.update as jest.Mock).mock.calls[0][0];
    expect(data.state).toBe('REJECTED');
    expect(data.rejectionReason).toBe('faltou o prazo');
  });

  it('recusa rejeição sem motivo', async () => {
    // "Rejeitado" sem porquê deixa a tela sem pista nenhuma — e quem rejeitou
    // já esqueceu na semana seguinte.
    const { service } = montar();

    await expect(service.reject(TENANT, 'art-1', ATOR, '   ')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejeitar NUNCA move o card de volta', async () => {
    // Mesmo com os 4 aprovados antes: rejeitar não é o oposto de aprovar no
    // fluxo. Voltar card por efeito colateral de outra tela ninguém entende.
    const { service, clients } = montar({ aprovados: 4 });

    await service.reject(TENANT, 'art-1', ATOR, 'motivo');

    expect(clients.transition).not.toHaveBeenCalled();
  });
});

describe('ArtifactReviewService.createHumanVersion: edição (§2.10, §7.4)', () => {
  const input = { parentVersionId: 'av-1', content: { texto: 'editado' } as never };

  it('cria versão com author "human" e parentVersionId', async () => {
    // §5: "a versão da IA continua legível e inalterada". A edição CRIA; nunca
    // reescreve.
    const { service, prisma } = montar();

    await service.createHumanVersion(TENANT, 'art-1', ATOR, input);

    const { data } = (prisma.artifactVersion.create as jest.Mock).mock.calls[0][0];
    expect(data.author).toBe('human');
    expect(data.parentVersionId).toBe('av-1');
    expect(data.editedBy).toBe(ATOR);
  });

  it('a versão humana NÃO carrega inputHash, model nem run', async () => {
    // Texto escrito à mão não tem insumo para hashear, nenhum modelo o produziu
    // e ele nasce fora do pipeline. Inventar um hash seria mentira com cara de
    // chave — e é por isso que o índice do PR-1 é parcial.
    const { service, prisma } = montar();

    await service.createHumanVersion(TENANT, 'art-1', ATOR, input);

    const { data } = (prisma.artifactVersion.create as jest.Mock).mock.calls[0][0];
    expect(data.inputHash).toBeUndefined();
    expect(data.model).toBeUndefined();
    expect(data.artifactRunId).toBeUndefined();
  });

  it('numera sequencial a partir da última versão', async () => {
    const { service, prisma } = montar({ ultimaVersao: 3 });

    await service.createHumanVersion(TENANT, 'art-1', ATOR, input);

    const { data } = (prisma.artifactVersion.create as jest.Mock).mock.calls[0][0];
    expect(data.version).toBe(4);
  });

  it('editar devolve o artefato a PENDING_REVIEW', async () => {
    // O conteúdo mudou depois de quem aprovou ter olhado. Manter APPROVED faria
    // a aprovação valer para um texto que ninguém aprovou.
    const { service, prisma } = montar();

    await service.createHumanVersion(TENANT, 'art-1', ATOR, input);

    const { data } = (prisma.artifact.update as jest.Mock).mock.calls[0][0];
    expect(data.state).toBe('PENDING_REVIEW');
    expect(data.currentVersionId).toBe('av-nova');
  });

  it('recusa pai que não pertence a este artefato', async () => {
    // Sem o filtro por `artifactId`, editar apontando para a versão de OUTRO
    // artefato gravaria linhagem que atravessa artefatos, e a tela mostraria um
    // pai que não é pai.
    const { service } = montar({ parent: null });

    await expect(
      service.createHumanVersion(TENANT, 'art-1', ATOR, input),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('artefato de outro tenant devolve não-encontrado', async () => {
    const { service } = montar({ artifact: null });

    await expect(
      service.createHumanVersion(TENANT, 'art-alheio', ATOR, input),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ArtifactReviewService: o revisor não é gate (§2.9, decisão 1)', () => {
  it('aprovar não consulta ReviewVerdict em momento algum', async () => {
    // O teste mais importante do arquivo, e ele afirma uma AUSÊNCIA. O parecer
    // é conteúdo de tela; lê-lo aqui daria à IA poder de veto por via indireta,
    // que é o oposto do MVP3 §6. Se alguém adicionar essa consulta, o
    // `reviewVerdict` inexistente no mock estoura — e o motivo estará escrito.
    const { service, prisma } = montar({ aprovados: 4 });

    await service.approve(TENANT, 'art-1', ATOR);

    expect((prisma as unknown as Record<string, unknown>).reviewVerdict).toBeUndefined();
  });
});
