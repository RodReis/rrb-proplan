import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IngestionService } from './ingestion.service';

function svc(overrides: any) {
  const prisma = {
    document: { findUnique: jest.fn().mockResolvedValue(overrides.doc) },
    project: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r' }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r' }),
    },
  };
  const auth = { userToken: jest.fn().mockResolvedValue('tok') };
  const git = {
    getRawBlob: jest.fn().mockResolvedValue(overrides.buffer ?? Buffer.from('x')),
  };
  return new IngestionService(
    prisma as any,
    {} as any,
    auth as any,
    git as any,
  );
}

describe('IngestionService.rawContent', () => {
  it('markdown → BadRequest', async () => {
    const s = svc({ doc: { blobSha: 's', kind: 'markdown' } });
    await expect(s.rawContent('u1', 'p1', 'a.md')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('path inexistente → NotFound', async () => {
    const s = svc({ doc: null });
    await expect(s.rawContent('u1', 'p1', 'x.png')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('image → stream com content-type', async () => {
    const s = svc({ doc: { blobSha: 's', kind: 'image' }, buffer: Buffer.from([1, 2]) });
    const out = await s.rawContent('u1', 'p1', 'logo.png');
    expect(out).toMatchObject({
      type: 'stream',
      contentType: 'image/png',
      isHtml: false,
    });
  });

  it('html → isHtml true', async () => {
    const s = svc({ doc: { blobSha: 's', kind: 'html' } });
    const out = await s.rawContent('u1', 'p1', 'r.html');
    expect(out).toMatchObject({
      type: 'stream',
      contentType: 'text/html',
      isHtml: true,
    });
  });
});
