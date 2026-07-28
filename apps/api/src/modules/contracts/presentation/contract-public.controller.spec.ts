import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContractLinkService } from '../application/contract-link.service';
import { ContractPublicController } from './contract-public.controller';

const VALIDO = {
  status: 'valid' as const,
  contract: {
    renderedHtml: '<p>Cláusula primeira.</p>',
    version: 1,
    expiresAt: '2026-07-30T12:00:00.000Z',
  },
};

function montar(resolvido: unknown = VALIDO) {
  const links = {
    resolvePublic: jest.fn(async () => resolvido),
  } as unknown as ContractLinkService;

  return { controller: new ContractPublicController(links), links };
}

function req(ip = '10.0.0.1'): Request {
  return { ip, socket: { remoteAddress: ip } } as unknown as Request;
}

function res() {
  const headers: Record<string, string> = {};
  const enviado: string[] = [];
  const objeto: Record<string, unknown> = {};

  objeto.send = jest.fn((body: string) => {
    enviado.push(body);
    return objeto;
  });
  objeto.setHeader = jest.fn((k: string, v: string) => {
    headers[k] = v;
    return objeto;
  });

  return { res: objeto as unknown as Response, headers, enviado };
}

describe('GET /c/:token: devolve a página do contrato', () => {
  it('responde HTML com o documento embutido', async () => {
    const { controller } = montar();
    const { res: resposta, enviado } = res();

    await controller.read('tok', req(), resposta);

    expect(enviado[0]).toContain('Cláusula primeira.');
    expect(enviado[0]).toContain('<!doctype html>');
  });

  it('resolve pelo token, nunca por nada do request', async () => {
    const { controller, links } = montar();
    await controller.read('tok-abc', req(), res().res);

    expect(links.resolvePublic).toHaveBeenCalledWith('tok-abc');
    expect(links.resolvePublic).toHaveBeenCalledTimes(1);
  });

  /**
   * §5, não-diferencial: o código de status é observável por quem sonda. Um 404
   * para inexistente e 200 para revogado distinguiria os dois — exatamente a
   * diferença que o critério proíbe expor. Todos saem 200, com a página
   * explicando o estado.
   */
  it.each(['invalid', 'expired', 'revoked'] as const)(
    'estado %s responde 200 com recado, não erro HTTP',
    async (status) => {
      const { controller } = montar({ status });
      const { res: resposta, enviado } = res();

      await expect(
        controller.read('tok', req(), resposta),
      ).resolves.toBeUndefined();
      expect(enviado[0]).not.toContain('Cláusula primeira.');
    },
  );
});

describe('GET /c/:token: rate limit com Retry-After (§5)', () => {
  it('barra a 21ª requisição do mesmo IP+token', async () => {
    const { controller } = montar();

    for (let i = 0; i < 20; i++) {
      await controller.read('tok', req(), res().res);
    }

    await expect(controller.read('tok', req(), res().res)).rejects.toThrow(
      HttpException,
    );
  });

  /**
   * O critério de aceite pede `Retry-After` **no 429** — o header, não uma
   * frase na descrição. `description` do Nest não vira header nenhum: vira
   * `cause`, que morre no servidor. Sem isto o cliente barrado não sabe quando
   * voltar, e o campo que a spec exige simplesmente não existe na resposta.
   */
  it('o 429 traz o header Retry-After em segundos', async () => {
    const { controller } = montar();
    for (let i = 0; i < 20; i++) {
      await controller.read('tok', req(), res().res);
    }

    const erro = await controller
      .read('tok', req(), res().res)
      .catch((e: unknown) => e as HttpException);

    expect(erro).toBeInstanceOf(HttpException);
    const headers = (erro as HttpException & {
      getResponse(): unknown;
    }).getResponse() as Record<string, unknown>;

    expect(headers).toMatchObject({ status: 'rate_limited' });
    // O header propriamente dito, via `res.setHeader` antes do throw.
    expect(erro).toHaveProperty('retryAfterSeconds');
    expect((erro as unknown as { retryAfterSeconds: number }).retryAfterSeconds)
      .toBeGreaterThan(0);
  });

  it('IP diferente não herda o limite de outro', async () => {
    const { controller } = montar();
    for (let i = 0; i < 20; i++) {
      await controller.read('tok', req('10.0.0.1'), res().res);
    }

    await expect(
      controller.read('tok', req('10.0.0.2'), res().res),
    ).resolves.toBeUndefined();
  });

  it('token diferente do mesmo IP não herda o limite', async () => {
    const { controller } = montar();
    for (let i = 0; i < 20; i++) {
      await controller.read('tok-a', req(), res().res);
    }

    await expect(
      controller.read('tok-b', req(), res().res),
    ).resolves.toBeUndefined();
  });
});

describe('GET /c/:token: a rota pública é só leitura (§2.7)', () => {
  const FONTE = readFileSync(
    join(__dirname, 'contract-public.controller.ts'),
    'utf8',
  );

  /**
   * Aceite anônimo seria assinatura sem garantia de assinatura. A ausência de
   * verbo de escrita é a regra, então é provada por ausência — um `@Post` neste
   * arquivo derruba o teste.
   */
  it.each(['@Post', '@Put', '@Patch', '@Delete'])(
    'não existe %s neste controller',
    (verbo) => {
      const semComentario = FONTE.replace(/\/\/.*$/gm, '').replace(
        /^\s*\*.*$/gm,
        '',
      );
      expect(semComentario).not.toContain(verbo);
    },
  );

  it('declara os headers que a decisão 8.1 exige', () => {
    expect(FONTE).toMatch(/Cache-Control['"],\s*['"]no-store/);
    expect(FONTE).toMatch(/Pragma['"],\s*['"]no-cache/);
    expect(FONTE).toMatch(/X-Robots-Tag['"],\s*['"]noindex,\s*nofollow/);
  });
});
