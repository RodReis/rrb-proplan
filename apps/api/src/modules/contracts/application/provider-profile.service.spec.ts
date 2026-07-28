import type { PrismaService } from '../../../prisma/prisma.service';
import { ProviderProfileService } from './provider-profile.service';

const PERFIL = {
  id: 'pp-1',
  tenantId: 't-1',
  legalName: 'Prestador ME',
  documentType: 'cnpj',
  document: '00000000000191',
  zipCode: '01001000',
  street: 'Praça da Sé, 1',
  district: 'Sé',
  city: 'São Paulo',
  state: 'SP',
  email: 'contato@prestador.com',
  phone: '11999999999',
  createdAt: new Date('2026-07-28T12:00:00Z'),
  updatedAt: new Date('2026-07-28T12:00:00Z'),
};

function montar(existente: typeof PERFIL | null = PERFIL) {
  const gravado: Array<Record<string, unknown>> = [];
  let linha = existente;

  const prisma = {
    providerProfile: {
      findUnique: jest.fn(async () => linha),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        gravado.push(create);
        linha = { ...PERFIL, ...create } as typeof PERFIL;
        return linha;
      }),
    },
  } as unknown as PrismaService;

  return { service: new ProviderProfileService(prisma), gravado };
}

describe('ProviderProfileService: só o owner altera (§2.1)', () => {
  it.each(['member', 'viewer', undefined])(
    'recusa alteração de %s com motivo legível',
    async (role) => {
      const { service, gravado } = montar();
      await expect(
        service.upsert('t-1', role as 'member', {
          legalName: 'Outro',
          documentType: 'cpf',
          document: '11111111111',
        }),
      ).rejects.toThrow(/dono do workspace/);
      expect(gravado).toHaveLength(0);
    },
  );

  it('aceita alteração do owner', async () => {
    const { service, gravado } = montar();
    await service.upsert('t-1', 'owner', {
      legalName: 'Prestador ME',
      documentType: 'cnpj',
      document: '00000000000191',
    });
    expect(gravado[0].legalName).toBe('Prestador ME');
  });

  it('canEdit é resolvido no servidor e viaja na resposta', async () => {
    // Regra duplicada no front divergiria da recusa real no primeiro clique, e
    // a tela mostraria campo editável para quem a API vai recusar — botão morto,
    // e pior, um que parece ter salvado.
    const { service } = montar();
    expect((await service.get('t-1', 'member')).canEdit).toBe(false);
    expect((await service.get('t-1', 'owner')).canEdit).toBe(true);
  });
});

describe('ProviderProfileService: identidade das partes', () => {
  it.each([
    ['nome vazio', { legalName: '  ', documentType: 'cnpj', document: '123' }, /Nome ou razão social/],
    ['documento vazio', { legalName: 'X', documentType: 'cnpj', document: '' }, /CPF ou CNPJ/],
  ])('recusa %s', async (_caso, input, mensagem) => {
    // O CHECK do banco barra de qualquer jeito; aqui o motivo chega legível à
    // tela em vez de virar um 500 de constraint.
    const { service } = montar();
    await expect(service.upsert('t-1', 'owner', input)).rejects.toThrow(mensagem);
  });

  it('recusa tipo de documento fora de cpf|cnpj', async () => {
    // O tipo decide o rótulo no contrato ("CPF nº" vs "CNPJ nº"): um valor fora
    // dos dois produziria rótulo errado no dado que identifica a parte.
    const { service } = montar();
    await expect(
      service.upsert('t-1', 'owner', {
        legalName: 'X',
        documentType: 'rg',
        document: '123',
      }),
    ).rejects.toThrow(/cpf.*cnpj/i);
  });

  it('campo opcional vazio vira null, não string vazia', async () => {
    // String vazia no banco mentiria dizendo "preenchido" — e um endereço ''
    // sairia no contrato como uma linha em branco entre vírgulas.
    const { service, gravado } = montar();
    await service.upsert('t-1', 'owner', {
      legalName: 'X',
      documentType: 'cpf',
      document: '111',
      city: '   ',
    });
    expect(gravado[0].city).toBeNull();
  });

  it('apara espaços do nome e do documento', async () => {
    const { service, gravado } = montar();
    await service.upsert('t-1', 'owner', {
      legalName: '  Prestador  ',
      documentType: 'cnpj',
      document: ' 00000000000191 ',
    });
    expect(gravado[0].legalName).toBe('Prestador');
    expect(gravado[0].document).toBe('00000000000191');
  });
});

describe('ProviderProfileService: ausência é informação (ADR-014)', () => {
  it('tenant sem perfil recebe a forma vazia com exists=false', async () => {
    // Não é 404: a configuração simplesmente ainda não existe, e a tela precisa
    // saber que é o primeiro preenchimento.
    const { service } = montar(null);
    const view = await service.get('t-1', 'owner');
    expect(view.exists).toBe(false);
    expect(view.legalName).toBe('');
    expect(view.canEdit).toBe(true);
  });

  it('require recusa emitir contrato sem perfil preenchido', async () => {
    // Emitir sem prestador identificado produziria um documento em que uma das
    // partes é `{{provider_name}}` cru.
    const { service } = montar(null);
    await expect(service.require('t-1')).rejects.toThrow(/perfil do prestador/i);
  });

  it('require devolve o perfil quando existe', async () => {
    const { service } = montar();
    await expect(service.require('t-1')).resolves.toMatchObject({
      legalName: 'Prestador ME',
    });
  });
});
