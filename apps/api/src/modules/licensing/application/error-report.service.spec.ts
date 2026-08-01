import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { MAX_PAYLOAD_BYTES } from '../domain/error-report-cap';
import { ErrorReportService } from './error-report.service';

const CHAVE = 'WR-AAAA-BBBB-CCCC-DDDD';

interface Opcoes {
  /** `null` = `resolve_license` não devolveu linha (chave inexistente). */
  status?: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | null;
}

/**
 * Dobra do Prisma. O RLS é do banco; aqui se testa a REGRA — quem passa pelo
 * gate, o que é gravado, e sob qual contexto de tenant.
 */
function montar(opcoes: Opcoes = {}) {
  const status = opcoes.status === undefined ? 'ACTIVE' : opcoes.status;
  const gravados: Array<Record<string, unknown>> = [];
  /** Os tenants sob os quais o `create` rodou — prova o `runInTenantContext`. */
  const contextos: string[][] = [];

  const prisma = {
    $queryRaw: jest.fn(async () =>
      status === null ? [] : [{ id: 'lic-1', tenant_id: 't-1', status }],
    ),
    runInTenantContext: jest.fn(async (ids: string[], fn: () => Promise<unknown>) => {
      contextos.push(ids);
      return fn();
    }),
    licErrorReport: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        gravados.push(data);
        return { id: 'err-1' };
      }),
    },
  } as unknown as PrismaService;

  return { service: new ErrorReportService(prisma), gravados, contextos, prisma };
}

const base = {
  licenseKey: CHAVE,
  appVersion: '1.0.2',
  os: 'win-x64',
  occurredAt: '2026-08-01T10:00:00Z',
  message: 'Erro ao abrir projeto',
  stack: 'at foo()\nat bar()',
  source: 'crash',
};

describe('SPEC-043: o gate da rota pública de relatos', () => {
  it('chave válida persiste o relato completo', async () => {
    const { service, gravados } = montar();

    const r = await service.receive({
      ...base,
      sessionTail: { arquivos: ['a.ts'] },
      userNote: 'travou ao salvar',
      contactEmail: 'ana@exemplo.com',
    });

    expect(r).toEqual({ received: true });
    expect(gravados[0]).toMatchObject({
      tenantId: 't-1',
      licenseId: 'lic-1',
      appVersion: '1.0.2',
      os: 'win-x64',
      message: 'Erro ao abrir projeto',
      stack: 'at foo()\nat bar()',
      sessionTail: { arquivos: ['a.ts'] },
      source: 'CRASH',
      userNote: 'travou ao salvar',
      contactEmail: 'ana@exemplo.com',
      occurredAt: new Date('2026-08-01T10:00:00Z'),
    });
  });

  it('chave inexistente responde 401', async () => {
    const { service } = montar({ status: null });
    await expect(service.receive(base)).rejects.toThrow(UnauthorizedException);
  });

  it('chave revogada responde 401 — o reembolsado não escreve mais aqui', async () => {
    // A revogação fechou o acesso; aceitar o relato reabriria um canal de
    // escrita para quem já não é cliente.
    const { service, gravados } = montar({ status: 'REVOKED' });

    await expect(service.receive(base)).rejects.toThrow(UnauthorizedException);
    expect(gravados).toHaveLength(0);
  });

  it('inexistente e revogada são indistinguíveis na resposta', async () => {
    // Distinguir diria a quem sonda quando ele acertou uma chave real.
    const inexistente = await montar({ status: null })
      .service.receive(base)
      .catch((e: Error) => e.message);
    const revogada = await montar({ status: 'REVOKED' })
      .service.receive(base)
      .catch((e: Error) => e.message);

    expect(inexistente).toBe(revogada);
  });

  it('licença expirada RELATA — o bug de quem não renovou continua sendo nosso', async () => {
    const { service, gravados } = montar({ status: 'EXPIRED' });

    await service.receive(base);

    expect(gravados).toHaveLength(1);
  });

  it('chave ausente responde 401, sem consultar o banco', async () => {
    const { service, prisma } = montar();

    await expect(service.receive({ ...base, licenseKey: '' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('campos obrigatórios ausentes respondem 422', async () => {
    const { service } = montar();

    await expect(service.receive({ ...base, message: '' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(service.receive({ ...base, appVersion: '' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(service.receive({ ...base, os: '' })).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});

describe('SPEC-043: o que o relato grava', () => {
  it('grava sob o contexto do tenant DONO da licença', async () => {
    // Fora dele o RLS fail-closed gravaria zero linhas SEM erro, e a rota
    // responderia 202 para um relato que não existe.
    const { service, contextos } = montar();

    await service.receive(base);

    expect(contextos).toEqual([['t-1']]);
  });

  it('trunca em vez de recusar — nunca 413', async () => {
    const { service, gravados } = montar();

    const r = await service.receive({
      ...base,
      sessionTail: { linhas: ['x'.repeat(MAX_PAYLOAD_BYTES)] },
    });

    expect(r).toEqual({ received: true });
    expect(gravados[0].sessionTail).toBeNull();
    // A mensagem sobrevive: é ela que agrupa e que abre o diagnóstico.
    expect(gravados[0].message).toBe('Erro ao abrir projeto');
  });

  it('`source` desconhecido cai em CRASH, não derruba o relato', async () => {
    // Campo de metadado não pode custar o relato inteiro. `manual` é a exceção
    // explícita; o resto é crash, que é a origem esmagadoramente mais comum.
    const { service, gravados } = montar();

    await service.receive({ ...base, source: 'sei-la' });

    expect(gravados[0].source).toBe('CRASH');
  });

  it('`source: manual` é reconhecido', async () => {
    const { service, gravados } = montar();
    await service.receive({ ...base, source: 'manual' });
    expect(gravados[0].source).toBe('MANUAL');
  });

  it('`occurredAt` inválido vira agora, sem perder o relato', async () => {
    // O relógio da máquina do cliente não é problema dele, e recusar por causa
    // de um metadado trocaria diagnóstico por rigor sem ganho.
    const { service, gravados } = montar();
    const antes = Date.now();

    await service.receive({ ...base, occurredAt: 'ontem de tarde' });

    const gravado = gravados[0].occurredAt as Date;
    expect(gravado.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('campos opcionais ausentes viram null, nunca string vazia', async () => {
    // String vazia no banco é indistinguível de "o usuário digitou nada" na
    // tela do admin — `null` diz que o campo não veio.
    const { service, gravados } = montar();

    await service.receive({
      licenseKey: CHAVE,
      appVersion: '1.0.2',
      os: 'win-x64',
      message: 'Erro',
      source: 'crash',
    });

    expect(gravados[0]).toMatchObject({
      stack: null,
      userNote: null,
      contactEmail: null,
      sessionTail: null,
    });
  });
});
