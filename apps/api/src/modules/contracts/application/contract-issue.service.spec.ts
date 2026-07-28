import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ContractTemplateService } from './contract-template.service';
import { ContractIssueService } from './contract-issue.service';

/**
 * Emissão do snapshot (SPEC-034 §2.5, §5).
 *
 * O que estes testes protegem é a diferença entre **copiar** e **referenciar**:
 * um contrato que lesse o cliente ou o template por FK mudaria em silêncio,
 * meses depois, o que está escrito num documento já enviado — e nada falharia.
 */

const BODY = [
  '# Contrato',
  '',
  'CONTRATADA: {{provider_name}}, nº {{provider_document}}, em {{provider_address}}.',
  '',
  'CONTRATANTE: {{client_name}}, nº {{client_document}}, em {{client_address}}.',
  '',
  '## Objeto ({{modality}})',
  '',
  '{{scope}}',
  '',
  'Valor: {{budget}} para {{effort_hours}} horas. Pagamento: {{payment_terms}}.',
  '',
  '{{date}}',
].join('\n');

interface ContratoRow {
  id: string;
  tenantId: string;
  clientProjectId: string;
  version: number;
  modality: string;
  estimateId: string;
  templateVersionId: string;
  renderedHtml: string;
  providerSnapshot: unknown;
  clientSnapshot: unknown;
  scopeSnapshot: unknown;
  budgetBrl: Prisma.Decimal;
  effortHours: Prisma.Decimal;
  paymentTerms: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

interface Opcoes {
  templateBody?: string;
  clientName?: string;
  clientCnpj?: string | null;
  clientCpf?: string | null;
  clientStreet?: string;
  scopeState?: string;
  scopeContent?: unknown;
  estimateAprovada?: boolean;
  scenarios?: unknown;
  comPerfil?: boolean;
}

function montar(opcoes: Opcoes = {}) {
  const contratos: ContratoRow[] = [];

  const versaoDoTemplate = {
    id: 'tplver-7',
    version: 3,
    body: opcoes.templateBody ?? BODY,
  };

  const cliente = {
    name: opcoes.clientName ?? 'Cliente Fulano',
    cpf: opcoes.clientCpf === undefined ? null : opcoes.clientCpf,
    cnpj: opcoes.clientCnpj === undefined ? '12.345.678/0001-90' : opcoes.clientCnpj,
    company: 'Fulano ME',
    street: opcoes.clientStreet ?? 'Rua B, 200',
    district: 'Centro',
    city: 'Porto Alegre',
    state: 'RS',
    zipCode: '90000-000',
  };

  /** As relações que o service pede no `include` das leituras de contrato. */
  const comRelacoes = (row: ContratoRow) => ({
    ...row,
    templateVersion: { version: versaoDoTemplate.version },
    estimate: { version: 2 },
  });

  const prisma: Record<string, any> = {
    clientProject: {
      findFirst: jest.fn(async () => ({ id: 'proj-1', state: 'CONTRACT_PENDING', client: cliente })),
    },
    artifact: {
      findFirst: jest.fn(async () => ({
        state: opcoes.scopeState ?? 'APPROVED',
        currentVersionId: 'artver-9',
      })),
    },
    artifactVersion: {
      findFirst: jest.fn(async () => ({
        id: 'artver-9',
        content: opcoes.scopeContent ?? {
          entregaveis: ['API REST', 'Painel web'],
          foraDeEscopo: ['App mobile'],
          premissas: [],
          riscos: [],
        },
      })),
    },
    estimate: {
      findFirst: jest.fn(async () =>
        (opcoes.estimateAprovada ?? true)
          ? {
              id: 'est-3',
              version: 2,
              scenarios: opcoes.scenarios ?? {
                provavel: { horas: '120.00', totalBrl: '48000.00' },
              },
            }
          : null,
      ),
    },
    providerProfile: {
      findUnique: jest.fn(async () =>
        (opcoes.comPerfil ?? true)
          ? {
              legalName: 'Acme Software Ltda',
              documentType: 'cnpj',
              document: '99.888.777/0001-66',
              street: 'Rua A, 100',
              district: 'Moinhos',
              city: 'Porto Alegre',
              state: 'RS',
              zipCode: '90001-000',
              email: 'contato@acme.dev',
              phone: null,
            }
          : null,
      ),
    },
    contract: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === 'string') {
          const achado = contratos.find((c) => c.id === where.id);
          return achado ? comRelacoes(achado) : null;
        }
        // Sem `id`: é a busca da última versão, dentro da emissão.
        return [...contratos].sort((a, b) => b.version - a.version)[0] ?? null;
      }),
      findMany: jest.fn(async () =>
        [...contratos].sort((a, b) => b.version - a.version).map(comRelacoes),
      ),
      create: jest.fn(async ({ data }: { data: Omit<ContratoRow, 'id' | 'createdAt' | 'acceptedAt'> }) => {
        const novo: ContratoRow = {
          ...data,
          id: `ct-${contratos.length + 1}`,
          acceptedAt: null,
          createdAt: new Date('2026-07-28T15:00:00Z'),
        };
        contratos.push(novo);
        return comRelacoes(novo);
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  const templates = {
    requireIssuable: jest.fn(async () => versaoDoTemplate),
  };

  const service = new ContractIssueService(
    prisma as unknown as PrismaService,
    templates as unknown as ContractTemplateService,
  );

  return { service, prisma, templates, contratos, versaoDoTemplate };
}

const EMISSAO = { modality: 'desenvolvimento', paymentTerms: '50% na assinatura' };

describe('emitir contrato — o snapshot (§2.5)', () => {
  it('grava HTML, valores e as três cópias', async () => {
    const { service, contratos } = montar();

    const contrato = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');

    expect(contrato.version).toBe(1);
    expect(contrato.renderedHtml).toContain('Acme Software Ltda');
    expect(contrato.renderedHtml).toContain('Cliente Fulano');
    expect(contrato.renderedHtml).toContain('R$ 48.000,00');
    expect(contrato.renderedHtml).toContain('120 horas');
    expect(contrato.renderedHtml).toContain('50% na assinatura');

    const gravado = contratos[0];
    expect(gravado.providerSnapshot).toMatchObject({ legalName: 'Acme Software Ltda' });
    expect(gravado.clientSnapshot).toMatchObject({ name: 'Cliente Fulano', documentType: 'cnpj' });
    expect(gravado.scopeSnapshot).toMatchObject({ entregaveis: ['API REST', 'Painel web'] });
  });

  it('o valor vai ao HTML SEM passar por Number (§6)', async () => {
    const { service } = montar({
      scenarios: { provavel: { horas: '120.00', totalBrl: '12345678901234567.89' } },
    });

    const contrato = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');
    expect(contrato.renderedHtml).toContain('R$ 12.345.678.901.234.567,89');
  });

  it('o escopo aprovado vira lista no documento', async () => {
    const { service } = montar();
    const contrato = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');
    expect(contrato.renderedHtml).toContain('<li>API REST</li>');
    expect(contrato.renderedHtml).toContain('<strong>Fora de escopo</strong>');
  });

  it('um cliente chamado <script> não executa na página (§5)', async () => {
    const { service } = montar({ clientName: '<script>alert(1)</script>' });
    const contrato = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');
    expect(contrato.renderedHtml).not.toContain('<script>');
    expect(contrato.renderedHtml).toContain('&lt;script&gt;');
  });

  it('refazer emite versão NOVA — nunca altera a anterior', async () => {
    const { service, contratos } = montar();

    const v1 = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');
    const v2 = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');

    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(contratos).toHaveLength(2);
    expect(contratos[0].id).not.toBe(contratos[1].id);
  });

  it('editar o template DEPOIS não altera o contrato emitido', async () => {
    const { service, versaoDoTemplate } = montar();

    const contrato = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');
    const antes = contrato.renderedHtml;

    // O dono salva uma versão nova do template.
    versaoDoTemplate.body = '# Outro contrato totalmente diferente';
    versaoDoTemplate.version = 4;

    const relido = await service.byId('t-1', contrato.id);
    expect(relido.renderedHtml).toBe(antes);
    expect(relido.renderedHtml).not.toContain('totalmente diferente');
  });

  it('editar o cliente DEPOIS não altera o contrato emitido', async () => {
    const { service, prisma, contratos } = montar();

    const contrato = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');

    // O prestador corrige o endereço do cliente meses depois.
    prisma.clientProject.findFirst = jest.fn(async () => ({
      id: 'proj-1',
      state: 'CONTRACT_PENDING',
      client: { name: 'Outro Nome', cpf: null, cnpj: '00.000.000/0001-00', company: null,
        street: 'Rua Nova', district: null, city: null, state: null, zipCode: null },
    })) as never;

    const relido = await service.byId('t-1', contrato.id);
    expect(relido.renderedHtml).toContain('Cliente Fulano');
    expect(relido.renderedHtml).not.toContain('Outro Nome');
    expect(contratos[0].clientSnapshot).toMatchObject({ name: 'Cliente Fulano' });
  });

  it('o snapshot aponta para a estimativa e a versão do template de origem', async () => {
    const { service, contratos } = montar();
    const contrato = await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');

    expect(contratos[0].estimateId).toBe('est-3');
    expect(contratos[0].templateVersionId).toBe('tplver-7');
    expect(contrato.estimateVersion).toBe(2);
    expect(contrato.templateVersion).toBe(3);
  });
});

describe('emitir contrato — as recusas com motivo legível (§5)', () => {
  it('template só com a versão semeada é recusado', async () => {
    const { service, templates } = montar();
    templates.requireIssuable = jest.fn(async () => {
      throw new Error('Edite e salve o template desta modalidade antes de emitir o primeiro contrato');
    }) as never;

    await expect(service.issue('t-1', 'proj-1', EMISSAO, 'u-1')).rejects.toThrow(
      /Edite e salve o template/,
    );
  });

  it('sem escopo aprovado, recusa', async () => {
    const { service } = montar({ scopeState: 'PENDING_REVIEW' });
    await expect(service.issue('t-1', 'proj-1', EMISSAO, 'u-1')).rejects.toThrow(
      /escopo precisa estar aprovado/,
    );
  });

  it('sem estimativa aprovada, recusa', async () => {
    const { service } = montar({ estimateAprovada: false });
    await expect(service.issue('t-1', 'proj-1', EMISSAO, 'u-1')).rejects.toThrow(
      /estimativa precisa estar aprovada/,
    );
  });

  it('sem perfil do prestador, recusa — a parte ficaria não identificada', async () => {
    const { service } = montar({ comPerfil: false });
    await expect(service.issue('t-1', 'proj-1', EMISSAO, 'u-1')).rejects.toThrow(
      /perfil do prestador/,
    );
  });

  it('estimativa aprovada sem cenário provável legível, recusa', async () => {
    // Sem isto o contrato sairia com valor em branco — documento plausível
    // dizendo nada sobre preço, o erro caro desta fatia.
    const { service } = montar({ scenarios: { otimista: { horas: '1', totalBrl: '1' } } });
    await expect(service.issue('t-1', 'proj-1', EMISSAO, 'u-1')).rejects.toThrow(
      /cenário provável/,
    );
  });

  it('modalidade ausente ou desconhecida é recusada antes de qualquer leitura', async () => {
    const { service, prisma } = montar();

    await expect(service.issue('t-1', 'proj-1', {}, 'u-1')).rejects.toThrow(/modalidade/);
    await expect(
      service.issue('t-1', 'proj-1', { modality: 'venda_de_alma' }, 'u-1'),
    ).rejects.toThrow(/modalidade/);
    expect(prisma.clientProject.findFirst).not.toHaveBeenCalled();
  });
});

describe('emitir contrato — o que ele NÃO faz', () => {
  it('emitir NÃO move o card (§2.6)', async () => {
    // Quem move para CONTRACT_PENDING é a aprovação da estimativa; quem move
    // para CONTRACT_APPROVED é o aceite (PR-5). Emitir duas versões não pode
    // mexer no funil duas vezes.
    const { service, prisma } = montar();
    await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');

    expect(prisma).not.toHaveProperty('clientStatusTransition');
    expect(JSON.stringify(Object.keys(prisma))).not.toContain('transition');
  });

  it('pagamento em branco vira null no banco, não string vazia', async () => {
    const { service, contratos } = montar();
    await service.issue('t-1', 'proj-1', { modality: 'desenvolvimento' }, 'u-1');
    expect(contratos[0].paymentTerms).toBeNull();
  });
});

describe('leitura dos contratos do projeto (§2.13)', () => {
  it('lista da versão mais recente para a mais antiga', async () => {
    const { service } = montar();
    await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');
    await service.issue('t-1', 'proj-1', EMISSAO, 'u-1');

    const lista = await service.list('t-1', 'proj-1');
    expect(lista.map((c) => c.version)).toEqual([2, 1]);
    expect(lista[0].budgetBrl).toBe('48000');
  });

  it('contrato de outro tenant não é encontrado', async () => {
    const { service, prisma } = montar();
    prisma.contract.findFirst = jest.fn(async () => null) as never;
    await expect(service.byId('t-2', 'ct-1')).rejects.toThrow(/não encontrado/i);
  });
});
