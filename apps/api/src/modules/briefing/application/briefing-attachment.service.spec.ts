import {
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { transactionMock } from '../../../../test/prisma-transaction-mock';
import { BriefingAttachmentService } from './briefing-attachment.service';
import { MAX_BRIEFING_FILES } from '../domain/file-signature';

/**
 * Anexos do briefing público (SPEC-031 §4, ADR-025).
 *
 * O que estes testes protegem:
 *
 *   - **a barreira é o conteúdo**: um executável com nome `.png` é recusado, e
 *     nada é gravado — o `Content-Type` do request nunca decide;
 *   - **a cota é real**: o 6º arquivo e o estouro de 25 MB param antes do INSERT;
 *   - **o link precisa aceitar escrita**: revogado, expirado e ENVIADO recusam
 *     anexo, como recusam save de etapa;
 *   - **remoção é do próprio rascunho**: o WHERE carrega o `briefingDraftId`,
 *     senão um id de outro rascunho do mesmo tenant seria apagável;
 *   - **o download não vaza entre tenants**: 404, nunca 403.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const LINK = 'bl-1';
const DRAFT = 'bd-1';
const PROJECT = 'cp-1';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
/** `MZ` — executável. O caso que motiva a verificação por assinatura. */
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

function row(over: Record<string, unknown> = {}) {
  return {
    link_id: LINK,
    expires_at: null,
    revoked_at: null,
    tenant_id: TENANT,
    client_project_id: PROJECT,
    draft_id: DRAFT,
    draft_consumed_at: null,
    version_count: 0,
    ...over,
  };
}

interface FakeOpts {
  link?: Record<string, unknown>;
  quota?: { file_count: number; total_bytes: bigint };
  deleted?: number;
  asset?: unknown;
}

function prismaFake(opts: FakeOpts = {}): any {
  const quota = opts.quota ?? { file_count: 0, total_bytes: BigInt(0) };

  const prisma: any = {
    fileAsset: {
      create: jest.fn(async ({ data }: any) => ({
        id: data.id,
        name: data.name,
        size: data.size,
        mime: data.mime,
      })),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(opts.asset ?? null),
      deleteMany: jest.fn().mockResolvedValue({ count: opts.deleted ?? 1 }),
    },
    briefingDraft: {
      upsert: jest.fn().mockResolvedValue({ id: DRAFT }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    // Duas funções SQL distintas atendidas pelo mesmo mock: a query de cota
    // menciona `briefing_draft_quota`, a de link menciona `resolve_`.
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('briefing_draft_quota')) return [quota];
      return [row(opts.link)];
    }),
    $transaction: transactionMock(() => prisma),
    runInTenantContext: jest.fn(
      async (_ids: string[], fn: () => Promise<unknown>) => fn(),
    ),
  };
  return prisma;
}

describe('BriefingAttachmentService (SPEC-031 §4)', () => {
  describe('upload: a barreira é o conteúdo, não o que foi declarado', () => {
    it('aceita PNG legítimo e devolve metadado sem os bytes', async () => {
      const prisma = prismaFake();
      const svc = new BriefingAttachmentService(prisma);

      const out = await svc.attach('tok', {
        buffer: PNG,
        originalname: 'logo.png',
      });

      expect(out.mime).toBe('image/png');
      expect(out.size).toBe(PNG.length);
      expect(out).not.toHaveProperty('bytes');
    });

    it('grava safeName gerado pelo servidor, não o nome enviado', async () => {
      const prisma = prismaFake();
      const svc = new BriefingAttachmentService(prisma);

      await svc.attach('tok', { buffer: PNG, originalname: '../../etc/passwd' });

      const { data } = prisma.fileAsset.create.mock.calls[0][0];
      expect(data.safeName).toBe(`${data.id}.png`);
      expect(data.safeName).not.toContain('/');
      // O original sobrevive como metadado exibível, mas saneado.
      expect(data.name).not.toContain('/');
    });

    it('recusa executável com nome de imagem e NÃO grava nada', async () => {
      const prisma = prismaFake();
      const svc = new BriefingAttachmentService(prisma);

      await expect(
        svc.attach('tok', { buffer: EXE, originalname: 'foto.png' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });

    it('recusa o 6º arquivo do briefing', async () => {
      const prisma = prismaFake({
        quota: { file_count: MAX_BRIEFING_FILES, total_bytes: BigInt(1000) },
      });
      const svc = new BriefingAttachmentService(prisma);

      await expect(
        svc.attach('tok', { buffer: PNG, originalname: 'a.png' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });

    it('recusa quando a soma passaria de 25 MB', async () => {
      const prisma = prismaFake({
        quota: { file_count: 2, total_bytes: BigInt(25 * 1024 * 1024) },
      });
      const svc = new BriefingAttachmentService(prisma);

      await expect(
        svc.attach('tok', { buffer: PNG, originalname: 'a.png' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('arquivo acima de 10 MB responde 413, não 422', async () => {
      const prisma = prismaFake();
      const svc = new BriefingAttachmentService(prisma);
      const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);

      await expect(
        svc.attach('tok', { buffer: big, originalname: 'a.png' }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it('cria rascunho vazio quando o anexo chega antes de qualquer save', async () => {
      const prisma = prismaFake({ link: { draft_id: null } });
      const svc = new BriefingAttachmentService(prisma);

      await svc.attach('tok', { buffer: PNG, originalname: 'a.png' });

      expect(prisma.briefingDraft.upsert).toHaveBeenCalled();
      expect(prisma.fileAsset.create.mock.calls[0][0].data.briefingDraftId).toBe(
        DRAFT,
      );
    });

    it('abre contexto de tenant antes de escrever (rota pública, sem sessão)', async () => {
      const prisma = prismaFake();
      const svc = new BriefingAttachmentService(prisma);

      await svc.attach('tok', { buffer: PNG, originalname: 'a.png' });

      expect(prisma.runInTenantContext).toHaveBeenCalledWith(
        [TENANT],
        expect.any(Function),
      );
    });
  });

  describe('upload: o link precisa aceitar escrita', () => {
    it('token inexistente responde 404', async () => {
      const prisma = prismaFake();
      prisma.$queryRaw = jest.fn().mockResolvedValue([]);
      const svc = new BriefingAttachmentService(prisma);

      await expect(
        svc.attach('tok', { buffer: PNG, originalname: 'a.png' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('link revogado responde 410 e não grava', async () => {
      const prisma = prismaFake({ link: { revoked_at: new Date() } });
      const svc = new BriefingAttachmentService(prisma);

      await expect(
        svc.attach('tok', { buffer: PNG, originalname: 'a.png' }),
      ).rejects.toBeInstanceOf(GoneException);
      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });

    it('briefing JÁ ENVIADO recusa anexo novo (versão é imutável)', async () => {
      const prisma = prismaFake({ link: { version_count: 1 } });
      const svc = new BriefingAttachmentService(prisma);

      await expect(
        svc.attach('tok', { buffer: PNG, originalname: 'a.png' }),
      ).rejects.toBeInstanceOf(GoneException);
      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });
  });

  describe('remoção', () => {
    it('apaga filtrando pelo rascunho, não só pelo id', async () => {
      const prisma = prismaFake();
      const svc = new BriefingAttachmentService(prisma);

      await svc.remove('tok', 'fa-1');

      expect(prisma.fileAsset.deleteMany).toHaveBeenCalledWith({
        where: { id: 'fa-1', briefingDraftId: DRAFT },
      });
    });

    it('id de outro rascunho responde 404 (nada apagado)', async () => {
      const prisma = prismaFake({ deleted: 0 });
      const svc = new BriefingAttachmentService(prisma);

      await expect(svc.remove('tok', 'fa-alheio')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('download autenticado', () => {
    it('devolve bytes e o mime provado no upload', async () => {
      const prisma = prismaFake({
        asset: { safeName: 'fa-1.png', mime: 'image/png', bytes: PNG },
      });
      const svc = new BriefingAttachmentService(prisma);

      const out = await svc.download(TENANT, 'fa-1');

      expect(out.mime).toBe('image/png');
      expect(out.safeName).toBe('fa-1.png');
      expect(Buffer.compare(out.bytes, PNG)).toBe(0);
    });

    it('filtra por tenant no WHERE, além do RLS', async () => {
      const prisma = prismaFake({
        asset: { safeName: 'fa-1.png', mime: 'image/png', bytes: PNG },
      });
      const svc = new BriefingAttachmentService(prisma);

      await svc.download(TENANT, 'fa-1');

      expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'fa-1', tenantId: TENANT } }),
      );
    });

    it('arquivo de outro tenant responde 404, nunca 403 (não-diferencial)', async () => {
      const prisma = prismaFake({ asset: null });
      const svc = new BriefingAttachmentService(prisma);

      await expect(svc.download(TENANT, 'fa-alheio')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
