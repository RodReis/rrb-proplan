import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { BriefingAttachmentController } from './briefing-attachment.controller';
import { BriefingLinkController } from './briefing-link.controller';
import { BriefingPublicController } from './briefing-public.controller';
import { BriefingReadController } from './briefing-read.controller';
import { FileAssetController } from './file-asset.controller';

/**
 * A `BriefingVersion` é IMUTÁVEL (SPEC-031 §5) — critério de aceite literal:
 * *"não existe rota que altere `BriefingVersion` — provado por teste que varre
 * as rotas do módulo (nenhum `PATCH`/`PUT`/`DELETE` sobre a entidade)"*.
 *
 * Este teste lê os **metadados de rota do Nest**, não o texto dos arquivos: é o
 * que o roteador realmente registra. Um `@Patch('briefing-versions/:id')` novo
 * quebra aqui mesmo que ninguém releia o comentário do controller.
 *
 * A varredura cobre os controllers do módulo inteiro, não só o de leitura — a
 * rota proibida poderia nascer em qualquer um deles.
 */

const CONTROLLERS = [
  BriefingLinkController,
  BriefingPublicController,
  BriefingAttachmentController,
  FileAssetController,
  BriefingReadController,
];

const WRITE_METHODS = new Set([
  RequestMethod.PATCH,
  RequestMethod.PUT,
  RequestMethod.DELETE,
]);

interface Route {
  controller: string;
  method: RequestMethod;
  path: string;
}

/** Todas as rotas registradas nos controllers do módulo. */
function routesOf(controllers: readonly Function[]): Route[] {
  const routes: Route[] = [];

  for (const controller of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = controller.prototype as object;

    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(proto, name)?.value;
      if (typeof handler !== 'function') continue;

      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;

      routes.push({
        controller: controller.name,
        method,
        path: `${base}/${String(Reflect.getMetadata(PATH_METADATA, handler) ?? '')}`,
      });
    }
  }

  return routes;
}

describe('BriefingVersion é imutável (SPEC-031 §5)', () => {
  const routes = routesOf(CONTROLLERS);

  it('a varredura encontra rotas — senão o teste passaria vazio', () => {
    // Sem esta âncora, um erro na leitura dos metadados transformaria o teste
    // abaixo em "nenhuma rota, logo nenhuma escrita": verde e sem valor.
    expect(routes.length).toBeGreaterThan(5);
  });

  it('nenhuma rota de escrita menciona briefing-versions', () => {
    const offending = routes.filter(
      (r) => WRITE_METHODS.has(r.method) && r.path.includes('briefing-version'),
    );

    expect(offending).toEqual([]);
  });

  it('o controller de leitura só expõe GET', () => {
    const read = routes.filter((r) => r.controller === BriefingReadController.name);

    expect(read.length).toBeGreaterThan(0);
    expect(read.every((r) => r.method === RequestMethod.GET)).toBe(true);
  });
});
