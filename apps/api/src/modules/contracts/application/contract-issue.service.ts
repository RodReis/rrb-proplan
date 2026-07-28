import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type ContractModality } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { renderContract, type RenderValues } from '../domain/render';
import {
  MODALITY_LABELS,
  formatAddress,
  formatBrlFromDecimalString,
  formatDateLong,
  formatHoursFromDecimalString,
  parseProvavel,
  parseScope,
  scopeToMarkup,
  type ClientSnapshot,
  type ProviderSnapshot,
} from '../domain/snapshot';
import { ContractTemplateService } from './contract-template.service';

/**
 * Emissão do contrato — o SNAPSHOT (SPEC-034 §2.5).
 *
 * ## A regra que organiza o service inteiro: copia, não referencia
 *
 * Prestador, cliente, escopo, valor e horas são **lidos uma vez, no ato da
 * emissão, e gravados dentro da linha**. Editar qualquer origem depois não muda
 * contrato emitido; refazer emite contrato **novo**, versionado.
 *
 * O `renderedHtml` também é gravado, não recalculado na leitura: renderizar de
 * novo a cada acesso permitiria que uma mudança no renderizador alterasse, meses
 * depois, um documento que o cliente já leu.
 *
 * ## Emitir NÃO move o card (§2.6)
 *
 * Quem move para `CONTRACT_PENDING` é a aprovação da estimativa (SPEC-033
 * §2.11); quem move para `CONTRACT_APPROVED` é o **registro do aceite** (PR-5).
 * Não há transição nenhuma neste arquivo, e há teste afirmando essa ausência —
 * emitir duas versões do contrato não pode mexer no funil duas vezes.
 */

export interface ContractSummary {
  id: string;
  version: number;
  modality: ContractModality;
  budgetBrl: string;
  effortHours: string;
  paymentTerms: string | null;
  templateVersion: number;
  estimateVersion: number;
  acceptedAt: string | null;
  createdAt: string;
}

export interface ContractDetail extends ContractSummary {
  renderedHtml: string;
  providerSnapshot: ProviderSnapshot;
  clientSnapshot: ClientSnapshot;
}

export interface IssueContractInput {
  modality?: unknown;
  /** Condições de pagamento — texto livre (§3: dados bancários fora da fatia). */
  paymentTerms?: unknown;
}

@Injectable()
export class ContractIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: ContractTemplateService,
  ) {}

  /**
   * Emite uma versão nova do contrato do projeto.
   *
   * A ordem das recusas é deliberada: **template, escopo, estimativa, perfil**.
   * Cada uma devolve motivo legível, porque a pessoa está a um clique de um
   * documento que vai para o cliente e precisa saber o que falta — não um 422
   * genérico que a manda adivinhar.
   */
  async issue(
    tenantId: string,
    clientProjectId: string,
    input: IssueContractInput,
    actorUserId: string | undefined,
  ): Promise<ContractDetail> {
    const modality = this.parseModality(input.modality);
    const projeto = await this.requireProject(tenantId, clientProjectId);

    // Trava do §2.3: o produto não emite contrato com texto que o dono nunca
    // leu. Vive no service, não na tela, para que qualquer caminho que não passe
    // pelo botão também seja recusado.
    const templateVersion = await this.templates.requireIssuable(tenantId, modality);

    const scope = await this.requireScopeAprovado(tenantId, clientProjectId);
    const estimate = await this.requireEstimateAprovada(tenantId, clientProjectId);
    const provider = await this.requireProviderProfile(tenantId);

    const provavel = parseProvavel(estimate.scenarios);
    if (provavel.totalBrl === '' || provavel.horas === '') {
      // Estimativa aprovada sem cenário provável legível: sem isto, o contrato
      // sairia com o valor em branco — um documento plausível dizendo nada
      // sobre preço, que é exatamente o erro caro desta fatia.
      throw new UnprocessableEntityException(
        'A estimativa aprovada não tem o cenário provável — recalcule antes de emitir.',
      );
    }

    const client = projeto.client;
    const providerSnapshot: ProviderSnapshot = {
      legalName: provider.legalName,
      documentType: provider.documentType,
      document: provider.document,
      address: formatAddress(provider),
      email: provider.email,
      phone: provider.phone,
    };
    const clientSnapshot: ClientSnapshot = {
      name: client.name,
      // CNPJ na frente: cliente que tem os dois é pessoa jurídica contratando,
      // e é o CNPJ que identifica a parte no contrato.
      document: client.cnpj ?? client.cpf ?? '',
      documentType: client.cnpj ? 'cnpj' : client.cpf ? 'cpf' : null,
      company: client.company,
      address: formatAddress(client),
    };
    const scopeSnapshot = parseScope(scope.content);

    const paymentTerms =
      typeof input.paymentTerms === 'string' && input.paymentTerms.trim() !== ''
        ? input.paymentTerms.trim()
        : null;

    const values: RenderValues = {
      provider_name: providerSnapshot.legalName,
      provider_document: providerSnapshot.document,
      provider_address: providerSnapshot.address,
      client_name: clientSnapshot.name,
      client_document: clientSnapshot.document,
      client_address: clientSnapshot.address,
      scope: scopeToMarkup(scopeSnapshot),
      // Os valores viajam como STRING do `Estimate` até o HTML — nenhum
      // `Number()` no caminho (§6). O contrato imprime o que a estimativa
      // congelou, não uma reconversão dele.
      budget: formatBrlFromDecimalString(provavel.totalBrl),
      effort_hours: formatHoursFromDecimalString(provavel.horas),
      payment_terms: paymentTerms ?? 'a combinar entre as partes',
      date: formatDateLong(new Date()),
      modality: MODALITY_LABELS[modality] ?? modality,
    };

    const renderedHtml = renderContract(templateVersion.body, values);

    // Interativa, não lote: sob contexto de tenant o lote sairia em duas
    // conexões (issue #113 / `batch-transaction.arch.spec.ts`).
    const contrato = await this.prisma.$transaction(async (tx) => {
      const ultima = await tx.contract.findFirst({
        where: { clientProjectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      return tx.contract.create({
        data: {
          tenantId,
          clientProjectId,
          version: (ultima?.version ?? 0) + 1,
          modality,
          estimateId: estimate.id,
          templateVersionId: templateVersion.id,
          renderedHtml,
          providerSnapshot: providerSnapshot as unknown as Prisma.InputJsonValue,
          clientSnapshot: clientSnapshot as unknown as Prisma.InputJsonValue,
          scopeSnapshot: scopeSnapshot as unknown as Prisma.InputJsonValue,
          budgetBrl: new Prisma.Decimal(provavel.totalBrl),
          effortHours: new Prisma.Decimal(provavel.horas),
          paymentTerms,
          createdBy: actorUserId ?? null,
        },
        include: {
          templateVersion: { select: { version: true } },
          estimate: { select: { version: true } },
        },
      });
    });

    return this.toDetail(contrato);
  }

  /** As versões emitidas do projeto, da mais recente para a mais antiga. */
  async list(tenantId: string, clientProjectId: string): Promise<ContractSummary[]> {
    await this.requireProject(tenantId, clientProjectId);

    const contratos = await this.prisma.contract.findMany({
      where: { tenantId, clientProjectId },
      orderBy: { version: 'desc' },
      include: {
        templateVersion: { select: { version: true } },
        estimate: { select: { version: true } },
      },
    });

    return contratos.map((c) => this.toSummary(c));
  }

  /** Um contrato, com o HTML — a leitura do painel (§2.13). */
  async byId(tenantId: string, contractId: string): Promise<ContractDetail> {
    const contrato = await this.prisma.contract.findFirst({
      where: { id: contractId, tenantId },
      include: {
        templateVersion: { select: { version: true } },
        estimate: { select: { version: true } },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato não encontrado');
    return this.toDetail(contrato);
  }

  private toSummary(c: ContratoComRelacoes): ContractSummary {
    return {
      id: c.id,
      version: c.version,
      modality: c.modality,
      // `.toString()` e não `Number`: o mesmo motivo do §6, agora na saída.
      budgetBrl: c.budgetBrl.toString(),
      effortHours: c.effortHours.toString(),
      paymentTerms: c.paymentTerms,
      templateVersion: c.templateVersion.version,
      estimateVersion: c.estimate.version,
      acceptedAt: c.acceptedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private toDetail(c: ContratoComRelacoes): ContractDetail {
    return {
      ...this.toSummary(c),
      renderedHtml: c.renderedHtml,
      providerSnapshot: c.providerSnapshot as unknown as ProviderSnapshot,
      clientSnapshot: c.clientSnapshot as unknown as ClientSnapshot,
    };
  }

  private parseModality(valor: unknown): ContractModality {
    const modalidades: readonly string[] = [
      'desenvolvimento',
      'desenvolvimento_manutencao',
      'desenvolvimento_venda_codigo',
    ];
    if (typeof valor !== 'string' || !modalidades.includes(valor)) {
      throw new UnprocessableEntityException(
        'Informe a modalidade do contrato: desenvolvimento, desenvolvimento_manutencao ou desenvolvimento_venda_codigo.',
      );
    }
    return valor as ContractModality;
  }

  /** Projeto do tenant, com o cliente que vira `clientSnapshot`. */
  private async requireProject(tenantId: string, clientProjectId: string) {
    const projeto = await this.prisma.clientProject.findFirst({
      where: { id: clientProjectId, deletedAt: null, client: { tenantId } },
      select: {
        id: true,
        state: true,
        client: {
          select: {
            name: true,
            cpf: true,
            cnpj: true,
            company: true,
            street: true,
            district: true,
            city: true,
            state: true,
            zipCode: true,
          },
        },
      },
    });
    if (!projeto) throw new NotFoundException('Projeto não encontrado');
    return projeto;
  }

  /**
   * A versão **corrente** do `scope`, exigindo o artefato `APPROVED` (§5).
   *
   * Corrente e não "a da IA": se um humano editou o escopo, é a edição dele que
   * vale — copiar a versão da IA descartaria a correção sem avisar, e o contrato
   * do cliente descreveria um escopo que ninguém aprovou. Mesmo desenho do
   * `exigirEffortAprovado` da SPEC-033.
   */
  private async requireScopeAprovado(tenantId: string, clientProjectId: string) {
    const artifact = await this.prisma.artifact.findFirst({
      where: { clientProjectId, tenantId, kind: 'scope' },
      select: { state: true, currentVersionId: true },
    });
    if (!artifact || artifact.state !== 'APPROVED' || !artifact.currentVersionId) {
      throw new UnprocessableEntityException(
        'O escopo precisa estar aprovado antes de emitir o contrato.',
      );
    }

    const version = await this.prisma.artifactVersion.findFirst({
      where: { id: artifact.currentVersionId, tenantId },
      select: { id: true, content: true },
    });
    if (!version) {
      throw new UnprocessableEntityException('Versão corrente do escopo não encontrada.');
    }
    return version;
  }

  /**
   * A `Estimate` **aprovada** mais recente (§5).
   *
   * Mais recente e não "a primeira": reestimar cria versão nova, e é a última
   * aprovada que reflete o preço que a pessoa decidiu mandar. Sem aprovação
   * nenhuma, recusa — um contrato tirado de estimativa não conferida teria a
   * mesma aparência de um conferido.
   */
  private async requireEstimateAprovada(tenantId: string, clientProjectId: string) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { tenantId, clientProjectId, approvedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, scenarios: true },
    });
    if (!estimate) {
      throw new UnprocessableEntityException(
        'A estimativa precisa estar aprovada antes de emitir o contrato.',
      );
    }
    return estimate;
  }

  /** Sem perfil, uma das partes ficaria não identificada no documento. */
  private async requireProviderProfile(tenantId: string) {
    const perfil = await this.prisma.providerProfile.findUnique({ where: { tenantId } });
    if (!perfil) {
      throw new UnprocessableEntityException(
        'Preencha o perfil do prestador antes de emitir o primeiro contrato.',
      );
    }
    return perfil;
  }
}

type ContratoComRelacoes = Prisma.ContractGetPayload<{
  include: {
    templateVersion: { select: { version: true } };
    estimate: { select: { version: true } };
  };
}>;
