import {
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Perfil do prestador — **um por tenant** (SPEC-034 §2.1).
 *
 * Alterável só pelo `owner`, mesma regra dos parâmetros de estimativa
 * (ADR-026): é dado que identifica uma das partes de um contrato, e quem assume
 * essa identidade é o dono do workspace.
 *
 * **Mascarado em log e em payload de erro, nunca no contrato em si** (§2.7): o
 * documento é justamente onde estes dados precisam aparecer por inteiro. A
 * distinção importa — mascarar no lugar errado produziria um contrato com
 * "CNPJ ***" e a aparência de estar completo.
 */

export interface ProviderProfileView {
  legalName: string;
  documentType: 'cpf' | 'cnpj';
  document: string;
  zipCode: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  /** Resolvido no servidor: a tela mostra leitura para quem não pode editar. */
  canEdit: boolean;
  /** `false` enquanto o prestador nunca preencheu — a emissão exige perfil. */
  exists: boolean;
}

export interface UpsertProviderProfileInput {
  legalName?: unknown;
  documentType?: unknown;
  document?: unknown;
  zipCode?: unknown;
  street?: unknown;
  district?: unknown;
  city?: unknown;
  state?: unknown;
  email?: unknown;
  phone?: unknown;
}

/** Campos de endereço/contato: opcionais, guardados como `null` quando vazios. */
const OPCIONAIS = [
  'zipCode',
  'street',
  'district',
  'city',
  'state',
  'email',
  'phone',
] as const;

const VAZIO: ProviderProfileView = {
  legalName: '',
  documentType: 'cnpj',
  document: '',
  zipCode: null,
  street: null,
  district: null,
  city: null,
  state: null,
  email: null,
  phone: null,
  canEdit: false,
  exists: false,
};

@Injectable()
export class ProviderProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, role: Role | undefined): Promise<ProviderProfileView> {
    const perfil = await this.prisma.providerProfile.findUnique({
      where: { tenantId },
    });

    // Ausência é informação (ADR-014), não erro: o tenant que nunca preencheu
    // recebe a forma vazia com `exists: false`, e a tela sabe que é o primeiro
    // preenchimento em vez de mostrar um 404 para uma configuração que
    // simplesmente ainda não existe.
    if (!perfil) return { ...VAZIO, canEdit: role === 'owner' };

    return {
      legalName: perfil.legalName,
      documentType: perfil.documentType as 'cpf' | 'cnpj',
      document: perfil.document,
      zipCode: perfil.zipCode,
      street: perfil.street,
      district: perfil.district,
      city: perfil.city,
      state: perfil.state,
      email: perfil.email,
      phone: perfil.phone,
      canEdit: role === 'owner',
      exists: true,
    };
  }

  /**
   * Cria ou substitui o perfil. `PUT` e não `PATCH`: o perfil é um só e é
   * substituído por inteiro — um `PATCH` deixaria o endereço antigo convivendo
   * com o novo documento se o cliente mandasse metade dos campos.
   *
   * **Não é versionado**, ao contrário do template: o contrato guarda o
   * `providerSnapshot` (PR-1), que é o que preserva o dado como estava no dia
   * da emissão. Versionar aqui guardaria a mesma história duas vezes.
   */
  async upsert(
    tenantId: string,
    role: Role | undefined,
    input: UpsertProviderProfileInput,
  ): Promise<ProviderProfileView> {
    if (role !== 'owner') {
      throw new ForbiddenException(
        'Só o dono do workspace altera o perfil do prestador',
      );
    }

    const legalName = texto(input.legalName);
    const document = texto(input.document);
    const documentType = texto(input.documentType);

    // Nome e documento identificam uma das partes do contrato. O CHECK do banco
    // barra de qualquer jeito; aqui o motivo chega legível à tela em vez de
    // virar um 500 de constraint.
    if (legalName === '') {
      throw new UnprocessableEntityException('Nome ou razão social é obrigatório');
    }
    if (document === '') {
      throw new UnprocessableEntityException('CPF ou CNPJ é obrigatório');
    }
    if (documentType !== 'cpf' && documentType !== 'cnpj') {
      // O tipo decide o rótulo no contrato ("CPF nº" vs "CNPJ nº"). Um valor
      // fora dos dois produziria rótulo errado no dado que identifica a parte.
      throw new UnprocessableEntityException(
        'Tipo de documento precisa ser `cpf` ou `cnpj`',
      );
    }

    const opcionais = Object.fromEntries(
      OPCIONAIS.map((campo) => [campo, textoOuNulo(input[campo])]),
    );

    const dados = { legalName, documentType, document, ...opcionais };

    await this.prisma.providerProfile.upsert({
      where: { tenantId },
      // `tenantId` por último, como no `EstimateSettingsService`: se o spread o
      // sobrescrevesse, a linha nasceria no tenant errado — defeito que a RLS
      // não pega, porque a escrita é legítima, só está no lugar errado.
      create: { ...dados, tenantId },
      update: dados,
    });

    return this.get(tenantId, role);
  }

  /**
   * O perfil que a emissão do contrato usa (PR-3). Lança quando não existe:
   * emitir sem prestador identificado produziria um documento em que uma das
   * partes é `{{provider_name}}` cru.
   */
  async require(tenantId: string) {
    const perfil = await this.prisma.providerProfile.findUnique({
      where: { tenantId },
    });
    if (!perfil) {
      throw new UnprocessableEntityException(
        'Preencha o perfil do prestador antes de emitir um contrato',
      );
    }
    return perfil;
  }
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** Vazio vira `null`: string vazia no banco mentiria dizendo "preenchido". */
function textoOuNulo(valor: unknown): string | null {
  const t = texto(valor);
  return t === '' ? null : t;
}
