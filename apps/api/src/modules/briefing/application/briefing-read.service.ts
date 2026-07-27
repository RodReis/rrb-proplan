import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { type Answers, completedStepCount, STEP_COUNT } from '../domain/briefing-steps';

/** Estado do briefing na gaveta do projeto (spec §6). */
export type BriefingState = 'not_started' | 'in_progress' | 'received';

export interface BriefingVersionRef {
  id: string;
  version: number;
  submittedAt: Date;
}

export interface BriefingStatus {
  state: BriefingState;
  /** Só em `in_progress`: quantas das 9 etapas já estão válidas. */
  completedSteps: number | null;
  totalSteps: number;
  /** Data do envio mais recente — `null` enquanto nada foi enviado. */
  receivedAt: Date | null;
  /** Mais nova primeiro. Vazia quando nada foi enviado. */
  versions: BriefingVersionRef[];
}

export interface BriefingAttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface BriefingVersionDetail {
  id: string;
  version: number;
  submittedAt: Date;
  clientProjectId: string;
  answers: Answers;
  /**
   * Rótulo de cada código gravado, indexado por `<etapa>.<campo>`.
   *
   * Ver `resolveLabels` — a versão é imutável, então a tradução acontece na
   * leitura, nunca no dado.
   */
  labels: Record<string, string>;
  attachments: BriefingAttachmentRef[];
}

/**
 * Leitura do briefing no painel do prestador (SPEC-031 §6).
 *
 * **Só leitura, em todos os papéis.** Não existe método de escrita aqui e não
 * pode existir: a `BriefingVersion` é imutável (spec §5) — nem o prestador nem
 * a IA alteram o que o cliente enviou. `viewer` lê igual a `owner`.
 *
 * Roda sob `/t/:tenant` com o contexto de tenant já aberto pelo interceptor, ao
 * contrário dos irmãos públicos deste módulo. O `tenantId` ainda entra em todo
 * `where`: o RLS é a rede de baixo, não a única.
 */
@Injectable()
export class BriefingReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estado do briefing de um projeto: não iniciado · em preenchimento (com
   * progresso) · recebido em *data*.
   *
   * O progresso sai do mesmo `completedStepCount` que a rota pública usa — a
   * gaveta e o formulário contam etapa concluída pela mesma regra, senão o
   * prestador veria "4 de 9" onde o cliente vê outra coisa.
   */
  async getStatus(tenantId: string, clientProjectId: string): Promise<BriefingStatus> {
    await this.assertProject(tenantId, clientProjectId);

    const [versions, draft] = await Promise.all([
      this.prisma.briefingVersion.findMany({
        where: { clientProjectId },
        orderBy: { version: 'desc' },
        select: { id: true, version: true, submittedAt: true },
      }),
      // O rascunho corrente é o do link ATIVO (não revogado). Um link revogado
      // deixa a linha do rascunho no banco, e contá-la mostraria progresso de
      // um preenchimento que já não pode continuar.
      this.prisma.briefingDraft.findFirst({
        where: {
          consumedAt: null,
          briefingLink: { clientProjectId, revokedAt: null },
        },
        orderBy: { updatedAt: 'desc' },
        select: { answers: true },
      }),
    ]);

    if (versions.length > 0) {
      return {
        state: 'received',
        completedSteps: null,
        totalSteps: STEP_COUNT,
        receivedAt: versions[0].submittedAt,
        versions,
      };
    }

    const completed = draft
      ? completedStepCount((draft.answers ?? {}) as Answers)
      : 0;

    // Rascunho existe mas nenhuma etapa fechou (só anexo enviado, por exemplo)
    // ⇒ ainda é "não iniciado". É o mesmo critério do funil: quem move o card é
    // o 1º save de etapa, não a criação da linha.
    return {
      state: completed > 0 ? 'in_progress' : 'not_started',
      completedSteps: completed > 0 ? completed : null,
      totalSteps: STEP_COUNT,
      receivedAt: null,
      versions: [],
    };
  }

  /** Uma versão em leitura, com os rótulos resolvidos e os anexos listados. */
  async getVersion(tenantId: string, id: string): Promise<BriefingVersionDetail> {
    const version = await this.prisma.briefingVersion.findFirst({
      where: { id, clientProject: { deletedAt: null, client: { tenantId } } },
      select: {
        id: true,
        version: true,
        submittedAt: true,
        clientProjectId: true,
        answers: true,
        files: {
          orderBy: { createdAt: 'asc' },
          // `bytes` fica FORA: são até 25 MB por briefing, e a listagem só
          // precisa do que a tela mostra. Os bytes saem pelo download.
          select: { id: true, name: true, mime: true, size: true },
        },
      },
    });

    // 404 e não 403, como no download do anexo: dizer "existe, mas não é seu"
    // confirmaria a existência da versão para quem sonda ids.
    if (!version) throw new NotFoundException('briefing não encontrado');

    const answers = (version.answers ?? {}) as Answers;

    return {
      id: version.id,
      version: version.version,
      submittedAt: version.submittedAt,
      clientProjectId: version.clientProjectId,
      answers,
      labels: await this.resolveLabels(answers),
      attachments: version.files,
    };
  }

  /**
   * Traduz os códigos da Etapa 1 para o que a pessoa escolheu na tela.
   *
   * A versão grava `segment: "G"`, `state: "SP"`, `city: "3550308"` — o painel
   * precisa de "Comércio e varejo", "São Paulo", "São Paulo". Não é enfeite: o
   * dogfooding do PR-3 pegou exatamente isto na revisão da etapa 9, e a
   * conclusão vale igual aqui — **ler o que não se entende não é ler**.
   *
   * A tradução acontece na LEITURA, nunca no dado: reescrever a versão para
   * guardar rótulo violaria a imutabilidade do §5, e congelaria um nome que a
   * tabela de referência pode corrigir depois.
   */
  private async resolveLabels(answers: Answers): Promise<Record<string, string>> {
    const step1 = (answers['1'] ?? answers[1] ?? {}) as Record<string, unknown>;
    const codeOf = (field: string) =>
      typeof step1[field] === 'string' && step1[field] !== ''
        ? (step1[field] as string)
        : null;

    const segment = codeOf('segment');
    const state = codeOf('state');
    const city = codeOf('city');

    // Nenhum código para traduzir: a etapa 1 é obrigatória, mas versão antiga
    // ou parcial não pode derrubar a leitura do resto.
    if (!segment && !state && !city) return {};

    const [segmentRow, stateRow, cityRow] = await Promise.all([
      segment
        ? this.prisma.segment.findUnique({
            where: { code: segment },
            select: { label: true },
          })
        : null,
      state
        ? this.prisma.state.findUnique({
            where: { code: state },
            select: { name: true },
          })
        : null,
      // `city` é gravada como o id do IBGE em string — a tela manda o `value` do
      // select, e o `jsonb` não tem número aqui.
      city && /^\d+$/.test(city)
        ? this.prisma.city.findUnique({
            where: { ibgeId: Number(city) },
            select: { name: true },
          })
        : null,
    ]);

    const labels: Record<string, string> = {};
    if (segmentRow) labels['1.segment'] = segmentRow.label;
    if (stateRow) labels['1.state'] = stateRow.name;
    if (cityRow) labels['1.city'] = cityRow.name;
    return labels;
  }

  /** Projeto do tenant, ou 404. Vale para não devolver estado de projeto alheio. */
  private async assertProject(tenantId: string, clientProjectId: string) {
    const project = await this.prisma.clientProject.findFirst({
      where: { id: clientProjectId, deletedAt: null, client: { tenantId } },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('projeto não encontrado');
  }
}
