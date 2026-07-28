import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ContractModality, Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CONTRACT_TEMPLATE_SEEDS } from '../../../../prisma/contract-templates.seed';
import { describeIssues, validatePlaceholders } from '../domain/placeholders';

/**
 * Templates de contrato, versionados (SPEC-034 §2.2, §2.3).
 *
 * **Editar cria versão nova; nada é alterado no lugar.** A versão anterior
 * continua legível porque um contrato emitido aponta para ela e precisa
 * continuar explicando de que texto saiu.
 *
 * **Só o `owner` escreve** (§5), mesma regra do perfil e dos parâmetros de
 * estimativa: é texto jurídico que vira o documento enviado ao cliente.
 */

export const MODALIDADES: readonly ContractModality[] = [
  'desenvolvimento',
  'desenvolvimento_manutencao',
  'desenvolvimento_venda_codigo',
];

export interface TemplateSummary {
  modality: ContractModality;
  /** `true` enquanto o texto é o semeado — a trava do §2.3 lê isto. */
  isSeedExample: boolean;
  currentVersion: number | null;
  updatedAt: string;
  /** Se emitir contrato desta modalidade seria recusado, e por quê. */
  readyToIssue: boolean;
}

export interface TemplateVersionView {
  id: string;
  version: number;
  body: string;
  createdBy: string | null;
  createdAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  body: string;
  canEdit: boolean;
}

@Injectable()
export class ContractTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Os três templates do tenant, semeando o que faltar. */
  async list(tenantId: string): Promise<TemplateSummary[]> {
    await this.ensureSeeded(tenantId);

    const templates = await this.prisma.contractTemplate.findMany({
      where: { tenantId },
      include: { currentVersion: { select: { version: true } } },
    });

    return MODALIDADES.map((modality) => {
      const t = templates.find((x) => x.modality === modality);
      return {
        modality,
        isSeedExample: t?.isSeedExample ?? true,
        currentVersion: t?.currentVersion?.version ?? null,
        updatedAt: (t?.updatedAt ?? new Date()).toISOString(),
        // Emitir exige template com versão salva pelo prestador (§2.3).
        readyToIssue: t ? !t.isSeedExample : false,
      };
    });
  }

  async detail(
    tenantId: string,
    modality: ContractModality,
    role: Role | undefined,
  ): Promise<TemplateDetail> {
    const template = await this.requireTemplate(tenantId, modality);
    const resumo = (await this.list(tenantId)).find((t) => t.modality === modality)!;
    return {
      ...resumo,
      body: template.currentVersion?.body ?? '',
      canEdit: role === 'owner',
    };
  }

  async versions(
    tenantId: string,
    modality: ContractModality,
  ): Promise<TemplateVersionView[]> {
    const template = await this.requireTemplate(tenantId, modality);
    const versoes = await this.prisma.contractTemplateVersion.findMany({
      where: { templateId: template.id },
      orderBy: { version: 'desc' },
    });
    return versoes.map((v) => ({
      id: v.id,
      version: v.version,
      body: v.body,
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  /**
   * Salva uma versão nova (`POST`, não `PATCH`: nada é alterado no lugar).
   *
   * É aqui que `isSeedExample` vira `false` — e é o que destrava a emissão de
   * contrato daquela modalidade (§2.3). A trava é deliberadamente fraca: exige
   * **uma** edição salva, não revisão de verdade. Ela não garante que o texto
   * foi lido; garante que o dono passou pela tela e assumiu o texto uma vez, e
   * que o `isSeedExample` deixa de mentir (§7.3).
   */
  async saveVersion(
    tenantId: string,
    modality: ContractModality,
    role: Role | undefined,
    body: unknown,
    userId: string | undefined,
  ): Promise<TemplateDetail> {
    if (role !== 'owner') {
      throw new ForbiddenException('Só o dono do workspace altera os templates');
    }

    const texto = typeof body === 'string' ? body.trim() : '';
    if (texto === '') {
      // Corpo vazio geraria um contrato em branco com aparência de contrato
      // emitido. O CHECK do banco barra também.
      throw new UnprocessableEntityException('O corpo do template não pode ser vazio');
    }

    // Validação ao SALVAR, não ao renderizar (§2.4): descoberto na emissão, o
    // placeholder errado ou vaza como literal cru no documento que o cliente lê,
    // ou derruba a emissão com o texto jurídico já escrito em cima dele.
    const problemas = validatePlaceholders(texto);
    if (problemas.length > 0) {
      throw new UnprocessableEntityException(describeIssues(problemas));
    }

    const template = await this.requireTemplate(tenantId, modality);

    // Interativa, não lote: sob contexto de tenant o lote sairia em duas
    // conexões (issue #113 / `batch-transaction.arch.spec.ts`).
    await this.prisma.$transaction(async (tx) => {
      const ultima = await tx.contractTemplateVersion.findFirst({
        where: { templateId: template.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      const versao = await tx.contractTemplateVersion.create({
        data: {
          templateId: template.id,
          version: (ultima?.version ?? 0) + 1,
          body: texto,
          createdBy: userId ?? null,
        },
      });

      await tx.contractTemplate.update({
        where: { id: template.id },
        data: { currentVersionId: versao.id, isSeedExample: false },
      });
    });

    return this.detail(tenantId, modality, role);
  }

  /**
   * A versão que a emissão usa (PR-3), já com a trava do §2.3 aplicada.
   *
   * Recusar aqui, e não na tela, é o que impede o produto de emitir contrato com
   * texto que o dono nunca leu por um caminho que não passe pelo botão.
   */
  async requireIssuable(tenantId: string, modality: ContractModality) {
    const template = await this.requireTemplate(tenantId, modality);

    if (template.isSeedExample) {
      throw new UnprocessableEntityException(
        'Edite e salve o template desta modalidade antes de emitir o primeiro contrato',
      );
    }
    if (!template.currentVersion) {
      throw new UnprocessableEntityException(
        'O template desta modalidade não tem versão salva',
      );
    }

    return template.currentVersion;
  }

  /** Existe e é deste tenant? Semeia se o tenant nasceu antes desta fatia. */
  private async requireTemplate(tenantId: string, modality: ContractModality) {
    if (!MODALIDADES.includes(modality)) {
      throw new NotFoundException('modalidade desconhecida');
    }

    await this.ensureSeeded(tenantId);

    const template = await this.prisma.contractTemplate.findUnique({
      where: { tenantId_modality: { tenantId, modality } },
      include: { currentVersion: true },
    });
    if (!template) throw new NotFoundException('template não encontrado');
    return template;
  }

  /**
   * Semeia os templates-exemplo que faltarem.
   *
   * O `prisma/seed.ts` cobre os tenants que existiam quando a fatia saiu; este
   * caminho cobre o tenant criado **depois**, que sem ele abriria a tela de
   * contratos vazia e não conseguiria emitir nada — um estado sem saída pela
   * própria UI.
   *
   * Idempotente pelo unique `(tenant_id, modality)`, e **nunca sobrescreve**:
   * template existente pode já ter versões escritas pelo dono.
   */
  private async ensureSeeded(tenantId: string): Promise<void> {
    const existentes = await this.prisma.contractTemplate.findMany({
      where: { tenantId },
      select: { modality: true },
    });
    const presentes = new Set(existentes.map((t) => t.modality));
    const faltando = CONTRACT_TEMPLATE_SEEDS.filter((s) => !presentes.has(s.modality));
    if (faltando.length === 0) return;

    for (const { modality, body } of faltando) {
      // Template e 1ª versão na MESMA transação: `currentVersionId` é nullable
      // só nesta janela, e um template sem versão corrente é um registro que a
      // tela mostra e a emissão não consegue usar.
      await this.prisma.$transaction(async (tx) => {
        const template = await tx.contractTemplate.create({
          data: { tenantId, modality, isSeedExample: true },
        });
        const versao = await tx.contractTemplateVersion.create({
          data: { templateId: template.id, version: 1, body },
        });
        await tx.contractTemplate.update({
          where: { id: template.id },
          data: { currentVersionId: versao.id },
        });
      });
    }
  }
}
