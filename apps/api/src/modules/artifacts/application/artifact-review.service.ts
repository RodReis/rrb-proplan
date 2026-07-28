import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../../clients/application/clients.service';
import { REQUIRED_ARTIFACT_COUNT } from '../domain/artifact-kind';

export interface EditInput {
  /** Versão da qual esta edição deriva. */
  parentVersionId: string;
  content: Prisma.InputJsonValue;
}

/**
 * Revisão humana dos artefatos (SPEC-032 §2.7, §2.10).
 *
 * O que este service **não** faz, e é o ponto: consultar o parecer do
 * `ArtifactReviewer` antes de aprovar. O veredito é conteúdo de tela (§2.9,
 * decisão 1 do PI); lê-lo aqui daria à IA poder de veto por via indireta.
 */
@Injectable()
export class ArtifactReviewService {
  private readonly logger = new Logger(ArtifactReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  /**
   * Aprova um artefato e, se for o último dos 4, move o card.
   *
   * O ator é o usuário autenticado e **nunca nulo** (§5) — diferente do
   * briefing, que move o card com ator nulo por ser público. Aqui há uma pessoa
   * decidindo, e a trilha precisa dizer quem.
   */
  async approve(tenantId: string, artifactId: string, actorUserId: string) {
    const artifact = await this.buscar(tenantId, artifactId);

    await this.prisma.artifact.update({
      where: { id: artifact.id },
      data: {
        state: 'APPROVED',
        reviewedAt: new Date(),
        reviewedBy: actorUserId,
        // Aprovar limpa o motivo de uma rejeição anterior: ele descrevia um
        // estado que deixou de valer, e mantê-lo faria a tela mostrar "aprovado"
        // ao lado de "rejeitado porque...".
        rejectionReason: null,
      },
    });

    const movido = await this.moverSeCompleto(tenantId, artifact.clientProjectId, actorUserId);
    return { state: 'APPROVED' as const, cardMoved: movido };
  }

  /**
   * Rejeita com motivo. **O card não se move** (§5) — fica onde está.
   *
   * Rejeitar não é o oposto de aprovar no fluxo: aprovar pode avançar o card,
   * rejeitar nunca o faz voltar. Voltar card por efeito colateral de outra tela
   * é o tipo de movimento que ninguém entende depois.
   */
  async reject(tenantId: string, artifactId: string, actorUserId: string, reason: string) {
    const motivo = reason?.trim();
    if (!motivo) {
      // O motivo é o que a spec manda registrar (§5). Rejeição sem motivo
      // deixaria a tela com "rejeitado" e nenhuma pista do porquê — e quem
      // rejeitou já esqueceu na semana seguinte.
      throw new UnprocessableEntityException('motivo da rejeição é obrigatório');
    }

    const artifact = await this.buscar(tenantId, artifactId);

    await this.prisma.artifact.update({
      where: { id: artifact.id },
      data: {
        state: 'REJECTED',
        rejectionReason: motivo,
        reviewedAt: new Date(),
        reviewedBy: actorUserId,
      },
    });

    return { state: 'REJECTED' as const, cardMoved: false };
  }

  /**
   * Edição humana: **cria versão nova**, nunca reescreve a da IA (§2.10).
   *
   * A imutabilidade continua; o que muda é o significado do artefato — deixa de
   * ser *"saída da IA"* e passa a ser *"linhagem, cada elo com autor"* (§7.4.1).
   * Por isso `author` e `parentVersionId` não são metadado opcional: sem eles a
   * linhagem some e ninguém mais sabe o que o modelo produziu.
   */
  async createHumanVersion(
    tenantId: string,
    artifactId: string,
    actorUserId: string,
    input: EditInput,
  ) {
    const artifact = await this.buscar(tenantId, artifactId);

    const parent = await this.prisma.artifactVersion.findFirst({
      where: { id: input.parentVersionId, artifactId: artifact.id },
      select: { id: true },
    });
    // Sem esta checagem, editar apontando para a versão de OUTRO artefato
    // gravaria uma linhagem que atravessa artefatos — e a tela mostraria um pai
    // que não é pai. O filtro por `artifactId` é o que amarra.
    if (!parent) {
      throw new UnprocessableEntityException(
        'versão de origem não encontrada neste artefato',
      );
    }

    const ultima = await this.prisma.artifactVersion.findFirst({
      where: { artifactId: artifact.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const version = await this.prisma.artifactVersion.create({
      data: {
        tenantId,
        artifactId: artifact.id,
        version: (ultima?.version ?? 0) + 1,
        content: input.content,
        author: 'human',
        parentVersionId: parent.id,
        editedBy: actorUserId,
        // `inputHash`, `model` e `artifactRunId` ficam NULOS de propósito: texto
        // escrito à mão não tem insumo para hashear, nenhum modelo o produziu e
        // ele nasce fora do pipeline. É por isso que o índice de idempotência é
        // parcial (`WHERE author = 'ai'`) — ver a migration do PR-1.
      },
      select: { id: true, version: true },
    });

    await this.prisma.artifact.update({
      where: { id: artifact.id },
      data: {
        currentVersionId: version.id,
        // Editar devolve o artefato à fila de revisão: o conteúdo mudou depois
        // de quem aprovou ter olhado, e manter `APPROVED` faria a aprovação
        // valer para um texto que ninguém aprovou.
        state: 'PENDING_REVIEW',
        rejectionReason: null,
      },
    });

    return version;
  }

  /**
   * Move o card para `ARTIFACTS_READY` **só com os 4 aprovados** (§2.7).
   *
   * A contagem é sobre `state = APPROVED`, e o UNIQUE `(clientProjectId, kind)`
   * do PR-1 é o que a torna confiável: sem ele um retry criaria o 5º `scope` e
   * "4 aprovados" passaria a contar duplicatas.
   */
  private async moverSeCompleto(
    tenantId: string,
    clientProjectId: string,
    actorUserId: string,
  ): Promise<boolean> {
    const aprovados = await this.prisma.artifact.count({
      where: { clientProjectId, state: 'APPROVED' },
    });
    if (aprovados < REQUIRED_ARTIFACT_COUNT) return false;

    try {
      await this.clients.transition(
        tenantId,
        clientProjectId,
        { to: 'ARTIFACTS_READY' },
        actorUserId,
      );
      return true;
    } catch (err) {
      // A transição pode ser recusada pela máquina de estados (card já adiante,
      // por exemplo). Isso NÃO pode desfazer a aprovação, que já está gravada e
      // é o ato que a pessoa pediu.
      this.logger.warn(
        `Aprovação completa do projeto ${clientProjectId}, mas a transição falhou: ` +
          `${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  /**
   * Busca dentro do tenant. Sob RLS o filtro já corta, mas a query é explícita:
   * o critério do §5 é que o artefato de outro tenant devolva **a mesma
   * resposta** de um id inexistente — e é isso que o `NotFoundException` faz.
   */
  private async buscar(tenantId: string, artifactId: string) {
    const artifact = await this.prisma.artifact.findFirst({
      where: { id: artifactId, tenantId },
      select: { id: true, clientProjectId: true, state: true },
    });
    if (!artifact) throw new NotFoundException('Artefato não encontrado');
    return artifact;
  }
}
