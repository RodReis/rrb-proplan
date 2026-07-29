import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type AcceptanceChannel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../../clients/application/clients.service';

/**
 * Canais válidos — **lista fechada** (§2.10, decisão 3 do PI).
 *
 * Texto livre aqui viraria `whatsapp`, `WhatsApp`, `zap` e `wpp` na mesma
 * coluna, e a pergunta *"por qual canal os contratos costumam ser aceitos?"*
 * deixaria de ter resposta. O enum existe no banco (PR-1); esta constante é o
 * mesmo fato do lado do TypeScript, e o teste afirma que os dois batem.
 */
export const ACCEPTANCE_CHANNELS = [
  'email',
  'whatsapp',
  'presencial',
  'telefone',
] as const;

export interface AcceptContractInput {
  channel?: AcceptanceChannel;
  note?: string;
}

export interface AcceptResult {
  accepted: true;
  cardMoved: boolean;
  alreadyAccepted: boolean;
}

/**
 * Registro do aceite do contrato (SPEC-034 §2.6 e §2.10).
 *
 * ## É aqui, e só aqui, que o card se move
 *
 * Emitir contrato **não** move nada (§2.6) — emitir duas versões não pode mexer
 * no funil duas vezes. Quem move `CONTRACT_PENDING → CONTRACT_APPROVED` é este
 * service, no ato do aceite.
 *
 * ## O aceite é registro do prestador, não assinatura do cliente
 *
 * A rota pública é de leitura e não tem botão "Aceito" (§2.7, §3): aceite
 * anônimo seria assinatura sem nenhuma garantia de assinatura. Quem registra é
 * quem tem sessão — e por isso o **ator nunca é nulo**. Um contrato "aceito por
 * ninguém" é o fechamento frágil que este produto existe para detectar.
 *
 * O `ClientStatusTransition.actorUserId` é nullable de propósito (transição
 * disparada pelo sistema, SPEC-031 §2), então a barreira do ator precisa morar
 * **aqui**, não no schema da trilha.
 *
 * ## A transição passa pelo `ClientsService`
 *
 * Nunca escrita direta em `client_projects`: a máquina de estados vive no
 * `domain/` do `clients` (ADR-001), e o `contracts-boundaries.arch.spec.ts`
 * prova que nenhuma escrita em tabela alheia sai deste módulo. Mesmo caminho
 * que o `EstimatesService.approve` já usa.
 */
@Injectable()
export class ContractAcceptanceService {
  private readonly logger = new Logger(ContractAcceptanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  async accept(
    tenantId: string,
    contractId: string,
    input: AcceptContractInput,
    actorUserId: string | null | undefined,
  ): Promise<AcceptResult> {
    // Ator ANTES de tudo: sem ele não há aceite a registrar, e chegar até a
    // escrita para só então descobrir isso deixaria a porta aberta a um caminho
    // futuro que esquecesse de passar o usuário.
    if (!actorUserId) {
      throw new UnprocessableEntityException(
        'o aceite exige o ator que o registrou — contrato aceito por ninguém não é aceite',
      );
    }

    const channel = this.parseChannel(input?.channel);
    const note = input?.note?.trim() || null;

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId },
      select: {
        id: true,
        clientProjectId: true,
        acceptedAt: true,
        version: true,
      },
    });
    if (!contract) throw new NotFoundException('contrato não encontrado');

    if (contract.acceptedAt) {
      // Idempotente e não erro: dois cliques no mesmo botão não são um problema
      // a reportar. O que não pode é o segundo mover o card de novo, nem
      // sobrescrever a data e o ator do aceite que realmente aconteceu.
      return { accepted: true, cardMoved: false, alreadyAccepted: true };
    }

    await this.prisma.contract.update({
      where: { id: contract.id },
      data: {
        acceptedAt: new Date(),
        acceptedBy: actorUserId,
        acceptanceChannel: channel,
        acceptanceNote: note,
      },
    });

    let cardMoved = false;
    try {
      await this.clients.transition(
        tenantId,
        contract.clientProjectId,
        { to: 'CONTRACT_APPROVED' },
        actorUserId,
      );
      cardMoved = true;
    } catch (err) {
      // A transição pode ser recusada pela máquina de estados (card já adiante,
      // por exemplo). Isso NÃO pode desfazer o aceite, que já está gravado e é o
      // ato que a pessoa pediu — mesmo desenho do `EstimatesService.approve` e
      // do `ArtifactReviewService`.
      this.logger.warn(
        `Contrato ${contract.id} aceito, mas a transição falhou: ` +
          `${err instanceof Error ? err.message : err}`,
      );
    }

    await this.audit(tenantId, 'contract.accepted', contract.id, {
      channel,
      acceptedBy: actorUserId,
      version: contract.version,
      cardMoved,
    });

    // O link NÃO é revogado (§8.4): o cliente relê o que aceitou, até o prazo
    // acabar. Nada aqui toca `contractLink`, e há teste afirmando essa ausência.
    return { accepted: true, cardMoved, alreadyAccepted: false };
  }

  /** Canal fora da lista fechada é recusado nomeando os válidos. */
  private parseChannel(value: unknown): AcceptanceChannel {
    if (
      typeof value === 'string' &&
      (ACCEPTANCE_CHANNELS as readonly string[]).includes(value)
    ) {
      return value as AcceptanceChannel;
    }
    throw new UnprocessableEntityException(
      `canal inválido — use um destes: ${ACCEPTANCE_CHANNELS.join(', ')}`,
    );
  }

  /** Ver `ClientsService.audit`: perder o evento é melhor que desfazer o fato. */
  private async audit(
    tenantId: string,
    kind: string,
    subject: string,
    payload: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.auditEvent.create({
        data: { tenantId, kind, subject, payload },
      });
    } catch {
      // ponytail: silencioso de propósito, como no ClientsService.
    }
  }
}
