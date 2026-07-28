import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { EstimateSettingsService } from './estimate-settings.service';

function montar(atual: Record<string, unknown> = {}) {
  const gravado: Array<Record<string, unknown>> = [];

  const linha = {
    hourlyRateBrl: new Prisma.Decimal('200'),
    contingencyPercent: new Prisma.Decimal('15'),
    exchangeRateUsdBrl: null as Prisma.Decimal | null,
    exchangeRateAt: null as Date | null,
    ...atual,
  };

  const prisma = {
    tenantSettings: {
      upsert: jest.fn(async ({ update }: { update?: Record<string, unknown> }) => {
        if (update && Object.keys(update).length > 0) {
          gravado.push(update);
          Object.assign(linha, update);
        }
        return linha;
      }),
    },
  } as unknown as PrismaService;

  return { service: new EstimateSettingsService(prisma), prisma, gravado, linha };
}

describe('EstimateSettingsService: só o owner altera (§2.6, ADR-026)', () => {
  it.each(['member', 'viewer', undefined])(
    'recusa alteração de %s com motivo legível',
    async (role) => {
      const { service, gravado } = montar();
      await expect(
        service.update('t-1', role as 'member', { hourlyRateBrl: '300' }),
      ).rejects.toThrow(/dono do workspace/);
      expect(gravado).toHaveLength(0);
    },
  );

  it('aceita alteração do owner', async () => {
    const { service, gravado } = montar();
    await service.update('t-1', 'owner', { hourlyRateBrl: '300' });
    expect(String(gravado[0].hourlyRateBrl)).toBe('300');
  });

  it('leitura é liberada para qualquer membro, com canEdit no servidor', async () => {
    // `canEdit` resolvido no servidor, não na tela: regra duplicada no front
    // divergiria da recusa real no primeiro clique.
    const { service } = montar();
    expect((await service.get('t-1', 'member')).canEdit).toBe(false);
    expect((await service.get('t-1', 'owner')).canEdit).toBe(true);
  });
});

describe('EstimateSettingsService: validação dos valores', () => {
  it.each([
    ['zero', '0'],
    ['negativo', '-50'],
  ])('recusa valor/hora %s', async (_caso, valor) => {
    // Orçamento de R$ 0,00 com aparência de conta feita é o pior formato de
    // erro num número que vira proposta.
    const { service } = montar();
    await expect(service.update('t-1', 'owner', { hourlyRateBrl: valor })).rejects.toThrow(
      /maior que zero/,
    );
  });

  it.each([
    ['acima de 100', '150'],
    ['negativa', '-1'],
  ])('recusa contingência %s', async (_caso, valor) => {
    // `150` no lugar de `15` multiplicaria o orçamento por 2,5 e pareceria
    // deliberado.
    const { service } = montar();
    await expect(
      service.update('t-1', 'owner', { contingencyPercent: valor }),
    ).rejects.toThrow(/entre 0% e 100%/);
  });

  it('aceita contingência 0 e 100 nas bordas', async () => {
    const { service, gravado } = montar();
    await service.update('t-1', 'owner', { contingencyPercent: '0' });
    await service.update('t-1', 'owner', { contingencyPercent: '100' });
    expect(gravado.map((g) => String(g.contingencyPercent))).toEqual(['0', '100']);
  });

  it.each([
    ['texto', 'muito'],
    ['vazio-ish', 'R$ 200'],
  ])('recusa valor não-numérico: %s', async (_caso, valor) => {
    const { service } = montar();
    await expect(service.update('t-1', 'owner', { hourlyRateBrl: valor })).rejects.toThrow(
      /precisa ser um número/,
    );
  });

  it('recusa taxa de câmbio zero ou negativa', async () => {
    const { service } = montar();
    await expect(
      service.update('t-1', 'owner', { exchangeRateUsdBrl: '0' }),
    ).rejects.toThrow(/maior que zero/);
  });
});

describe('EstimateSettingsService: o par taxa + data (§2.6)', () => {
  it('gravar a taxa carimba a data no SERVIDOR', async () => {
    // A data responde "quando esta cotação foi informada". Aceitá-la do cliente
    // permitiria carimbar hoje uma taxa do ano passado — a confusão que o par
    // existe para evitar.
    const { service, gravado } = montar();
    await service.update('t-1', 'owner', { exchangeRateUsdBrl: '5.42' });
    expect(String(gravado[0].exchangeRateUsdBrl)).toBe('5.42');
    expect(gravado[0].exchangeRateAt).toBeInstanceOf(Date);
  });

  it.each([
    ['null explícito', null],
    ['string vazia', ''],
  ])('limpar a taxa (%s) apaga os DOIS campos', async (_caso, valor) => {
    // Cotação velha é pior que nenhuma: segue exibida como se fosse corrente.
    // Sem o `null`, não haveria como voltar atrás depois de digitar uma vez.
    const { service, gravado } = montar({
      exchangeRateUsdBrl: new Prisma.Decimal('5.42'),
      exchangeRateAt: new Date('2026-01-01'),
    });
    await service.update('t-1', 'owner', { exchangeRateUsdBrl: valor });
    expect(gravado[0]).toMatchObject({ exchangeRateUsdBrl: null, exchangeRateAt: null });
  });

  it('campo ausente não mexe na taxa', async () => {
    // `undefined` ≠ `null`: um não foi enviado, o outro pediu para limpar.
    const { service, gravado } = montar({
      exchangeRateUsdBrl: new Prisma.Decimal('5.42'),
      exchangeRateAt: new Date('2026-01-01'),
    });
    await service.update('t-1', 'owner', { hourlyRateBrl: '300' });
    expect(gravado[0]).not.toHaveProperty('exchangeRateUsdBrl');
    expect(gravado[0]).not.toHaveProperty('exchangeRateAt');
  });
});

describe('EstimateSettingsService: leitura', () => {
  it('devolve os padrões da spec quando a linha nasce', async () => {
    const { service } = montar();
    expect(await service.get('t-1', 'owner')).toEqual({
      hourlyRateBrl: '200',
      contingencyPercent: '15',
      exchangeRateUsdBrl: null,
      exchangeRateAt: null,
      canEdit: true,
    });
  });

  it('devolve Decimal como string, nunca number', async () => {
    // Serializado como número, um valor com muitas casas perderia precisão
    // exatamente no dado que a fatia existe para manter exato.
    const { service } = montar({ hourlyRateBrl: new Prisma.Decimal('333.33') });
    const out = await service.get('t-1', 'owner');
    expect(typeof out.hourlyRateBrl).toBe('string');
    expect(out.hourlyRateBrl).toBe('333.33');
  });

  it('câmbio nulo é estado legítimo, não pendência', async () => {
    const { service } = montar();
    const out = await service.get('t-1', 'member');
    expect(out.exchangeRateUsdBrl).toBeNull();
    expect(out.exchangeRateAt).toBeNull();
  });
});
