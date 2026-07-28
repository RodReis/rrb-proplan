import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller';

/**
 * A `ArtifactVersion` é IMUTÁVEL (SPEC-032 §6) — critério de aceite literal:
 * *"não existe rota que altere `BriefingVersion` nem `ArtifactVersion` (teste
 * que lê os metadados de rota do Nest, no padrão do PR-6 da SPEC-031,
 * **estendido ao módulo novo**)"*.
 *
 * Lê os metadados que o roteador realmente registra, não o texto dos arquivos:
 * um `@Patch('artifacts/:id/versions/:versionId')` novo quebra aqui mesmo que
 * ninguém releia o comentário do controller.
 */

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

describe('ArtifactVersion é imutável (SPEC-032 §6)', () => {
  const routes = routesOf([ArtifactsController]);

  it('a varredura encontra rotas — senão o teste passaria vazio', () => {
    // Sem esta âncora, um erro na leitura dos metadados transformaria o teste
    // abaixo em "nenhuma rota, logo nenhuma escrita": verde e sem valor.
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  it('nenhuma rota de escrita destrutiva no módulo', () => {
    const offending = routes.filter((r) => WRITE_METHODS.has(r.method));

    expect(offending).toEqual([]);
  });

  it('editar é POST em .../versions — nada é alterado no lugar', () => {
    // O verbo carrega a regra (§6): "não é `PATCH`: nada é alterado no lugar".
    // Quem lê a rota vê que uma versão NASCE.
    const edicao = routes.find((r) => r.path.endsWith('artifacts/:id/versions'));

    expect(edicao).toBeDefined();
    expect(edicao!.method).toBe(RequestMethod.POST);
  });

  it('as leituras são GET', () => {
    const leituras = routes.filter((r) => r.path.includes('client-projects'));

    expect(leituras.length).toBeGreaterThan(0);
    expect(leituras.every((r) => r.method === RequestMethod.GET)).toBe(true);
  });
});
