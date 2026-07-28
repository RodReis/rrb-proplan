import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ArtifactsService } from '../../artifacts/application/artifacts.service';
import { ARTIFACTS_MODEL } from '../../artifacts/artifacts.config';
import { inputHashOf } from '../../artifacts/domain/input-hash';
import { LlmClientFactory, LlmUsageRecorder, UsageService } from '../../llm';
import {
  EFFORT_MAX_TOKENS,
  EFFORT_PROMPT_VERSION,
  EFFORT_SYSTEM,
  buildEffortUser,
  parseEffort,
  requisitosSemTarefa,
  titulosDeRequisitos,
} from '../domain/effort-estimator';

/** Motivos de parada, em português — vão para `ArtifactRun.failureReason` e à tela. */
const MOTIVO_TETO = 'Teto de gasto de IA do tenant atingido antes de gerar a decomposição.';

/**
 * A 5ª capacidade, disparada **sob demanda** (SPEC-033 §2.2, §7.2).
 *
 * Duas diferenças do pipeline da SPEC-032, e as duas são deliberadas:
 *
 * 1. **Gatilho humano, não evento.** Só existe botão com o `ClientProject` já em
 *    `ARTIFACTS_READY` — decompor requisito que ainda pode mudar seria trabalho
 *    descartável, e pago.
 * 2. **Run próprio.** O `effort_breakdown` não pertence ao run do
 *    `BriefingSubmitted`; nasce de um `ArtifactRun` aberto aqui.
 *
 * O que este service **não** faz: somar, multiplicar ou precificar. Isso é do
 * cálculo determinístico (PR-3). Aqui a IA decompõe e o resultado é gravado como
 * artefato comum — revisável, versionado e **inútil até um humano aprovar**.
 */
@Injectable()
export class EffortBreakdownService {
  private readonly logger = new Logger(EffortBreakdownService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactsService,
    private readonly llmFactory: LlmClientFactory,
    private readonly recorder: LlmUsageRecorder,
    private readonly usageGate: UsageService,
  ) {}

  /**
   * Gera a decomposição a partir da versão **corrente** do `requirements`
   * aprovado.
   *
   * Roda no caminho da request, e isso é a exceção que o ADR-002 comporta? Não —
   * é por isso que o controller enfileira. Este método é chamado **pelo worker**,
   * dentro de `runInTenantContext`.
   */
  async generate(input: {
    tenantId: string;
    clientProjectId: string;
  }): Promise<void> {
    const projeto = await this.exigirArtifactsReady(input.tenantId, input.clientProjectId);
    const requirements = await this.exigirRequirementsAprovado(
      input.tenantId,
      input.clientProjectId,
    );

    // Teto antes de qualquer chamada (§2.6 da SPEC-032, mesma regra). O gatilho
    // aqui é humano e há uma tela esperando, mas o gate é o mesmo: estourado, não
    // se gasta.
    if (!(await this.usageGate.canSpendForTenant(input.tenantId))) {
      this.logger.warn(
        `Teto do tenant ${input.tenantId} atingido — decomposição do projeto ${input.clientProjectId} não gerada`,
      );
      const runId = await this.abrirRun(input, projeto.briefingVersionId);
      await this.artifacts.closeExternalRun(runId, 'FAILED', [], MOTIVO_TETO);
      return;
    }

    const titulos = titulosDeRequisitos(requirements.content);
    const inputHash = inputHashOf({
      kind: 'effort_breakdown',
      promptVersion: EFFORT_PROMPT_VERSION,
      // O insumo desta capacidade **é o requirements aprovado**, não as respostas
      // do briefing: é dele que as tarefas saem. Passar `answers` aqui faria o
      // hash mudar por edição de briefing que não afeta a decomposição, e não
      // mudar quando alguém corrige um requisito à mão — exatamente ao contrário
      // do que a idempotência precisa.
      answers: requirements.content,
      upstream: {},
    });

    const runId = await this.abrirRun(input, projeto.briefingVersionId);

    try {
      const client = this.llmFactory.create('anthropic');
      const conteudo = await this.recorder.runParsed(
        client,
        {
          system: EFFORT_SYSTEM,
          user: buildEffortUser(requirements.content),
          maxTokens: EFFORT_MAX_TOKENS,
          model: ARTIFACTS_MODEL,
        },
        {
          projectId: null,
          tenantId: input.tenantId,
          artifactRunId: runId,
          kind: 'artifact_effort_breakdown',
          inputHash,
        },
        (text) => parseEffort(text, titulos),
      );

      // Requisito sem tarefa **anota, não bloqueia**: recusar o artefato inteiro
      // jogaria fora as outras tarefas boas, pagando o modelo de novo por elas.
      // A lacuna vai junto do conteúdo, para a tela mostrar e o humano decidir.
      const lacunas = requisitosSemTarefa(conteudo, titulos);
      if (lacunas.length > 0) {
        this.logger.log(
          `Decomposição do projeto ${input.clientProjectId} deixou ${lacunas.length} requisito(s) sem tarefa`,
        );
      }

      await this.artifacts.saveExternalVersion({
        tenantId: input.tenantId,
        clientProjectId: input.clientProjectId,
        kind: 'effort_breakdown',
        content: { ...conteudo, requisitosSemTarefa: lacunas },
        inputHash,
        promptVersion: EFFORT_PROMPT_VERSION,
        model: ARTIFACTS_MODEL,
        artifactRunId: runId,
      });

      await this.artifacts.closeExternalRun(runId, 'COMPLETED', ['effort_breakdown'], null);
      this.logger.log(`Decomposição gerada para o projeto ${input.clientProjectId}`);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Decomposição do projeto ${input.clientProjectId} falhou: ${motivo}`,
      );
      // Falha explícita com motivo legível. O run fica `FAILED` e a tela diz por
      // quê — o que NÃO se faz é gravar artefato pela metade.
      await this.artifacts.closeExternalRun(runId, 'FAILED', [], motivo);
    }
  }

  /**
   * O estado do `effort_breakdown` no painel (§6, rota de leitura).
   *
   * Devolve o kind **sempre**, mesmo sem nunca ter rodado: ausência é informação
   * (ADR-014), e omitir faria a tela não saber distinguir "ainda não gerei" de
   * "gerei e falhou".
   */
  async read(tenantId: string, clientProjectId: string) {
    const projeto = await this.prisma.clientProject.findFirst({
      where: { id: clientProjectId, client: { tenantId } },
      select: { id: true, state: true },
    });
    if (!projeto) throw new NotFoundException('Projeto não encontrado');

    const artifact = await this.prisma.artifact.findFirst({
      where: { clientProjectId, tenantId, kind: 'effort_breakdown' },
      select: {
        id: true,
        kind: true,
        state: true,
        currentVersionId: true,
        rejectionReason: true,
        reviewedAt: true,
        reviewedBy: true,
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            author: true,
            model: true,
            promptVersion: true,
            editedBy: true,
            parentVersionId: true,
            createdAt: true,
          },
        },
      },
    });

    const run = await this.prisma.artifactRun.findFirst({
      where: { clientProjectId, tenantId },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        status: true,
        completedKinds: true,
        failureReason: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    return {
      // `canGenerate` é servidor, não tela: a rota recusa fora de
      // `ARTIFACTS_READY` de qualquer jeito (§5), e um botão habilitado por
      // regra duplicada no front divergiria da recusa real no primeiro clique.
      canGenerate: projeto.state === 'ARTIFACTS_READY',
      state: projeto.state,
      artifact: artifact ?? { kind: 'effort_breakdown' as const, state: null, versions: [] },
      // Só o run que gerou ESTA capacidade — o run do pipeline original não diz
      // nada sobre a decomposição.
      run: run?.completedKinds.includes('effort_breakdown') ? run : null,
    };
  }

  /**
   * Valida o gate **antes de enfileirar** (§5: "antes disso, a rota recusa com
   * motivo legível").
   *
   * Existe além da checagem que `generate` já faz no worker, e não é
   * redundância: aqui o motivo chega à tela como resposta do clique; lá, ele
   * cobre o caso de o card mudar de estado entre o clique e o job. As duas
   * respondem a perguntas diferentes — "posso pedir?" e "ainda vale?".
   */
  async assertCanGenerate(tenantId: string, clientProjectId: string): Promise<void> {
    await this.exigirArtifactsReady(tenantId, clientProjectId);
    await this.exigirRequirementsAprovado(tenantId, clientProjectId);
  }

  /**
   * Quantas gerações já houve para este projeto, + 1 — a chave da fila.
   *
   * Conta **todos** os runs do projeto, inclusive os `FAILED` e os do pipeline
   * original: é justamente o que falhou que precisa produzir chave nova, senão o
   * job retido em `completed` no Redis engoliria o próximo clique em silêncio
   * (achado do dogfooding da Fatia 21).
   *
   * Contar `completedKinds: {has: 'effort_breakdown'}` seria o filtro
   * "certo" e **reintroduziria o bug**: run `FAILED` fecha com `completedKinds`
   * vazio, não entraria na conta, e a tentativa seguinte reusaria a mesma chave
   * — que é exatamente o caso que precisa de chave nova. Contar demais só custa
   * um número maior; contar de menos custa o botão parar de funcionar.
   *
   * Falha na contagem não impede o disparo: cai em `Date.now()`, que garante
   * chave única ao custo da numeração legível.
   */
  async nextAttempt(tenantId: string, clientProjectId: string): Promise<number> {
    try {
      const total = await this.prisma.artifactRun.count({
        where: { clientProjectId, tenantId },
      });
      return total + 1;
    } catch (err) {
      this.logger.warn(
        `Não consegui contar as decomposições de ${clientProjectId}: ${err instanceof Error ? err.message : err}`,
      );
      return Date.now();
    }
  }

  /** Abre o run sob demanda, com o briefing que originou os artefatos. */
  private async abrirRun(
    input: { tenantId: string; clientProjectId: string },
    briefingVersionId: string,
  ): Promise<string> {
    return this.artifacts.openExternalRun({
      tenantId: input.tenantId,
      clientProjectId: input.clientProjectId,
      briefingVersionId,
      kind: 'effort_breakdown',
    });
  }

  /**
   * O gate do §2.2: sem `ARTIFACTS_READY`, **recusa com motivo legível**.
   *
   * A checagem é aqui e não só no controller porque o worker também chama — e um
   * job enfileirado antes de o card voltar de estado geraria decomposição sobre
   * requisito que deixou de valer.
   */
  private async exigirArtifactsReady(
    tenantId: string,
    clientProjectId: string,
  ): Promise<{ briefingVersionId: string }> {
    const projeto = await this.prisma.clientProject.findFirst({
      where: { id: clientProjectId, client: { tenantId } },
      select: { id: true, state: true },
    });
    if (!projeto) throw new NotFoundException('Projeto não encontrado');
    if (projeto.state !== 'ARTIFACTS_READY') {
      throw new UnprocessableEntityException(
        'A decomposição só pode ser gerada com os 4 artefatos aprovados ' +
          `(o projeto está em ${projeto.state}).`,
      );
    }

    const briefing = await this.prisma.briefingVersion.findFirst({
      where: { clientProjectId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!briefing) {
      // Não deveria acontecer — `ARTIFACTS_READY` implica briefing enviado —,
      // mas seguir sem ele gravaria run órfão de insumo.
      throw new UnprocessableEntityException(
        'Projeto sem briefing enviado — não há insumo para decompor.',
      );
    }
    return { briefingVersionId: briefing.id };
  }

  /**
   * A versão **corrente** do `requirements`, exigindo o artefato `APPROVED`.
   *
   * Corrente e não "a da IA": se um humano editou os requisitos (§2.10 da
   * SPEC-032), é a edição dele que vale — decompor a versão da IA ignoraria a
   * correção e produziria tarefas para um requisito que deixou de existir.
   */
  private async exigirRequirementsAprovado(
    tenantId: string,
    clientProjectId: string,
  ): Promise<{ id: string; content: unknown }> {
    const artifact = await this.prisma.artifact.findFirst({
      where: { clientProjectId, tenantId, kind: 'requirements' },
      select: { id: true, state: true, currentVersionId: true },
    });
    if (!artifact || artifact.state !== 'APPROVED' || !artifact.currentVersionId) {
      throw new UnprocessableEntityException(
        'Os requisitos precisam estar aprovados antes de decompor o esforço.',
      );
    }
    const version = await this.prisma.artifactVersion.findFirst({
      where: { id: artifact.currentVersionId, tenantId },
      select: { id: true, content: true },
    });
    if (!version) {
      throw new UnprocessableEntityException('Versão corrente dos requisitos não encontrada.');
    }
    return { id: version.id, content: version.content };
  }
}
