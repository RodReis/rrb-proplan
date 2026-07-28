import type { PrismaService } from '../../../prisma/prisma.service';
import { ContractTemplateService } from './contract-template.service';

interface TemplateRow {
  id: string;
  tenantId: string;
  modality: string;
  currentVersionId: string | null;
  isSeedExample: boolean;
  updatedAt: Date;
}

interface VersionRow {
  id: string;
  templateId: string;
  version: number;
  body: string;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * Estado em memória com as três modalidades semeadas — o ponto de partida real
 * de um tenant depois do seed.
 */
function montar(opcoes: { isSeedExample?: boolean } = {}) {
  const seed = opcoes.isSeedExample ?? true;

  const templates: TemplateRow[] = [
    'desenvolvimento',
    'desenvolvimento_manutencao',
    'desenvolvimento_venda_codigo',
  ].map((modality, i) => ({
    id: `tpl-${i}`,
    tenantId: 't-1',
    modality,
    currentVersionId: `ver-${i}`,
    isSeedExample: seed,
    updatedAt: new Date('2026-07-28T12:00:00Z'),
  }));

  const versoes: VersionRow[] = templates.map((t, i) => ({
    id: `ver-${i}`,
    templateId: t.id,
    version: 1,
    body: 'Contrato de {{client_name}} por {{budget}}',
    createdBy: null,
    createdAt: new Date('2026-07-28T12:00:00Z'),
  }));

  const comVersao = (t: TemplateRow) => ({
    ...t,
    currentVersion: versoes.find((v) => v.id === t.currentVersionId) ?? null,
  });

  const tx = {
    contractTemplateVersion: {
      findFirst: jest.fn(async ({ where }: { where: { templateId: string } }) => {
        const doTemplate = versoes
          .filter((v) => v.templateId === where.templateId)
          .sort((a, b) => b.version - a.version);
        return doTemplate[0] ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Omit<VersionRow, 'id' | 'createdAt'> }) => {
        const nova: VersionRow = {
          ...data,
          id: `ver-nova-${versoes.length}`,
          createdAt: new Date(),
        };
        versoes.push(nova);
        return nova;
      }),
    },
    contractTemplate: {
      create: jest.fn(async ({ data }: { data: Partial<TemplateRow> }) => {
        const novo = {
          id: `tpl-novo-${templates.length}`,
          currentVersionId: null,
          isSeedExample: true,
          updatedAt: new Date(),
          ...data,
        } as TemplateRow;
        templates.push(novo);
        return novo;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<TemplateRow> }) => {
          const alvo = templates.find((t) => t.id === where.id)!;
          Object.assign(alvo, data);
          return alvo;
        },
      ),
    },
  };

  const prisma = {
    contractTemplate: {
      findMany: jest.fn(async () => templates.map(comVersao)),
      findUnique: jest.fn(
        async ({ where }: { where: { tenantId_modality: { modality: string } } }) => {
          const t = templates.find(
            (x) => x.modality === where.tenantId_modality.modality,
          );
          return t ? comVersao(t) : null;
        },
      ),
      create: tx.contractTemplate.create,
      update: tx.contractTemplate.update,
    },
    contractTemplateVersion: {
      findMany: jest.fn(async ({ where }: { where: { templateId: string } }) =>
        versoes
          .filter((v) => v.templateId === where.templateId)
          .sort((a, b) => b.version - a.version),
      ),
      findFirst: tx.contractTemplateVersion.findFirst,
      create: tx.contractTemplateVersion.create,
    },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  return {
    service: new ContractTemplateService(prisma),
    templates,
    versoes,
  };
}

const CORPO_VALIDO = 'Contrato de {{client_name}}, valor {{budget}}, {{effort_hours}} h';

describe('ContractTemplateService: só o owner altera (§5)', () => {
  it.each(['member', 'viewer', undefined])('recusa alteração de %s', async (role) => {
    const { service, versoes } = montar();
    const antes = versoes.length;
    await expect(
      service.saveVersion('t-1', 'desenvolvimento', role as 'member', CORPO_VALIDO, 'u1'),
    ).rejects.toThrow(/dono do workspace/);
    expect(versoes).toHaveLength(antes);
  });

  it('canEdit viaja na resposta, resolvido no servidor', async () => {
    const { service } = montar();
    expect((await service.detail('t-1', 'desenvolvimento', 'member')).canEdit).toBe(false);
    expect((await service.detail('t-1', 'desenvolvimento', 'owner')).canEdit).toBe(true);
  });
});

describe('ContractTemplateService: editar cria versão (§2.2)', () => {
  it('salvar cria a v2 e a v1 continua legível', async () => {
    // A anterior precisa continuar legível porque um contrato emitido aponta
    // para ela e tem de continuar explicando de que texto saiu.
    const { service, versoes } = montar();
    await service.saveVersion('t-1', 'desenvolvimento', 'owner', CORPO_VALIDO, 'u1');

    const doTemplate = versoes.filter((v) => v.templateId === 'tpl-0');
    expect(doTemplate.map((v) => v.version).sort()).toEqual([1, 2]);
    expect(doTemplate.find((v) => v.version === 1)?.body).toContain('{{client_name}}');
  });

  it('a versão nova vira a corrente', async () => {
    const { service, templates } = montar();
    await service.saveVersion('t-1', 'desenvolvimento', 'owner', CORPO_VALIDO, 'u1');
    expect(templates[0].currentVersionId).toBe('ver-nova-3');
  });

  it('registra quem salvou', async () => {
    const { service, versoes } = montar();
    await service.saveVersion('t-1', 'desenvolvimento', 'owner', CORPO_VALIDO, 'u1');
    expect(versoes.at(-1)?.createdBy).toBe('u1');
  });

  it('recusa corpo vazio', async () => {
    const { service } = montar();
    await expect(
      service.saveVersion('t-1', 'desenvolvimento', 'owner', '   ', 'u1'),
    ).rejects.toThrow(/não pode ser vazio/);
  });
});

describe('ContractTemplateService: placeholder é validado ao salvar (§2.4)', () => {
  it('recusa placeholder desconhecido, com o nome na mensagem', async () => {
    // Descoberto na renderização já é tarde: ou vaza como literal cru no
    // documento que o cliente lê, ou derruba a emissão com o texto jurídico já
    // escrito em cima dele.
    const { service, versoes } = montar();
    const antes = versoes.length;
    await expect(
      service.saveVersion('t-1', 'desenvolvimento', 'owner', 'Olá {{client_nome}}', 'u1'),
    ).rejects.toThrow(/client_nome/);
    expect(versoes).toHaveLength(antes);
  });

  it('recusa duration_days — a emenda §8.7 tirou dias do contrato', async () => {
    const { service } = montar();
    await expect(
      service.saveVersion('t-1', 'desenvolvimento', 'owner', 'Prazo {{duration_days}}', 'u1'),
    ).rejects.toThrow(/duration_days/);
  });

  it('aceita corpo só com placeholders conhecidos', async () => {
    const { service } = montar();
    await expect(
      service.saveVersion('t-1', 'desenvolvimento', 'owner', CORPO_VALIDO, 'u1'),
    ).resolves.toMatchObject({ isSeedExample: false });
  });
});

describe('ContractTemplateService: a trava do seed (§2.3, §7.3)', () => {
  it('template ainda semeado não pode emitir contrato', async () => {
    // O produto não emite contrato com texto que o dono nunca leu. Recusar no
    // service, e não na tela, impede a emissão por um caminho que não passe
    // pelo botão.
    const { service } = montar({ isSeedExample: true });
    await expect(service.requireIssuable('t-1', 'desenvolvimento')).rejects.toThrow(
      /Edite e salve o template/,
    );
  });

  it('salvar uma versão destrava a emissão', async () => {
    // A trava é deliberadamente fraca: exige UMA edição salva, não revisão de
    // verdade. Não garante que o texto foi lido — garante que o dono passou
    // pela tela e assumiu o texto uma vez.
    const { service } = montar({ isSeedExample: true });
    await service.saveVersion('t-1', 'desenvolvimento', 'owner', CORPO_VALIDO, 'u1');
    await expect(service.requireIssuable('t-1', 'desenvolvimento')).resolves.toMatchObject({
      body: CORPO_VALIDO,
    });
  });

  it('a trava é POR MODALIDADE, não global', async () => {
    // Editar o template de desenvolvimento não pode destravar o de cessão de
    // código: são textos jurídicos diferentes, e é justamente a cláusula de
    // propriedade que difere entre eles.
    const { service } = montar({ isSeedExample: true });
    await service.saveVersion('t-1', 'desenvolvimento', 'owner', CORPO_VALIDO, 'u1');
    await expect(
      service.requireIssuable('t-1', 'desenvolvimento_venda_codigo'),
    ).rejects.toThrow(/Edite e salve o template/);
  });

  it('a listagem expõe readyToIssue por modalidade', async () => {
    const { service } = montar({ isSeedExample: true });
    await service.saveVersion('t-1', 'desenvolvimento', 'owner', CORPO_VALIDO, 'u1');

    const lista = await service.list('t-1');
    expect(lista.find((t) => t.modality === 'desenvolvimento')?.readyToIssue).toBe(true);
    expect(
      lista.find((t) => t.modality === 'desenvolvimento_manutencao')?.readyToIssue,
    ).toBe(false);
  });

  it('lista sempre as três modalidades', async () => {
    const { service } = montar();
    expect((await service.list('t-1')).map((t) => t.modality)).toEqual([
      'desenvolvimento',
      'desenvolvimento_manutencao',
      'desenvolvimento_venda_codigo',
    ]);
  });
});

describe('ContractTemplateService: modalidade desconhecida', () => {
  it('recusa modalidade que não existe', async () => {
    const { service } = montar();
    await expect(
      service.detail('t-1', 'consultoria' as 'desenvolvimento', 'owner'),
    ).rejects.toThrow(/modalidade desconhecida/);
  });
});
