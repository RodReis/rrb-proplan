import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ContractsController } from './contracts.controller';

/**
 * O `Contract` é IMUTÁVEL (SPEC-034 §2.5) — critério de aceite literal: *"não
 * existe rota que altere `Contract` (teste que lê metadados de rota do Nest,
 * padrão do PR-6 da SPEC-031, estendido ao módulo novo)"*.
 *
 * Lê os **metadados de rota do Nest**, não o texto dos arquivos: é o que o
 * roteador realmente registra. Um `@Patch('contracts/:id')` novo quebra aqui
 * mesmo que ninguém releia o comentário do controller.
 *
 * ## A exceção nominal, e por que ela é uma lista
 *
 * `PUT /provider-profile` é a única escrita-no-lugar do módulo. A regra que
 * este teste protege é sobre **conteúdo versionado** (`Contract`,
 * `ContractTemplateVersion`); o perfil do prestador **não é versionado** — é um
 * por tenant, substituído por inteiro, e cada contrato guarda o seu
 * `providerSnapshot` (PR-1), que é o que preserva o dado como estava no dia da
 * emissão.
 *
 * A exceção é **lista de nomes**, não padrão genérico: afrouxar o filtro
 * deixaria a próxima entrar sem ninguém decidir. É o mesmo desenho da exceção
 * de `tenant-settings` no `artifact-version-immutable.spec.ts`.
 */

const CONTROLLERS = [ContractsController];

const WRITE_METHODS = new Set([
  RequestMethod.PATCH,
  RequestMethod.PUT,
  RequestMethod.DELETE,
]);

/**
 * Rotas de escrita-no-lugar permitidas. Cada nova entrada é uma decisão.
 *
 * - `provider-profile` (PR-2): perfil não é versionado — um por tenant,
 *   substituído por inteiro, e cada contrato guarda o seu `providerSnapshot`.
 * - `contracts/:id/link` (PR-4): o link é **credencial de acesso**, não
 *   documento. Revogar não toca o contrato — o `renderedHtml` continua imutável
 *   e legível no painel; o que morre é a URL pública (§2.8, revogação em 1
 *   clique com efeito imediato).
 */
const EXCECOES = ['provider-profile', 'contracts/:id/link'];

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

describe('Contract é imutável (SPEC-034 §2.5)', () => {
  const routes = routesOf(CONTROLLERS);

  it('a varredura encontra rotas — senão o teste passaria vazio', () => {
    // Sem esta âncora, um erro na leitura dos metadados transformaria os testes
    // abaixo em "nenhuma rota, logo nenhuma escrita": verde e sem valor.
    expect(routes.length).toBeGreaterThan(4);
  });

  it('nenhuma rota de escrita alcança o contrato em si', () => {
    // O `/link` no fim do caminho é a fronteira: `contracts/:id` é o documento
    // (imutável), `contracts/:id/link` é a credencial de acesso a ele. Um
    // `DELETE contracts/:id` — ou qualquer escrita que pare no documento —
    // continua derrubando este teste.
    const offending = routes.filter(
      (r) =>
        WRITE_METHODS.has(r.method) &&
        r.path.includes('contract') &&
        !r.path.endsWith('/link'),
    );
    expect(offending).toEqual([]);
  });

  it('a escrita permitida em contracts para no link, nunca no documento', () => {
    const escritasEmContrato = routes
      .filter((r) => WRITE_METHODS.has(r.method) && r.path.includes('contracts/'))
      .map((r) => r.path.replace(/^t\/:tenant\//, ''));

    // Exatamente uma, e é o link. Se alguém acrescentar `contracts/:id` aqui,
    // a lista deixa de bater e a decisão aparece no diff.
    expect(escritasEmContrato).toEqual(['contracts/:id/link']);
  });

  it('a única escrita-no-lugar do módulo é a exceção nominal', () => {
    const escritas = routes
      .filter((r) => WRITE_METHODS.has(r.method))
      .map((r) => r.path.replace(/^t\/:tenant\//, ''));
    expect(escritas).toEqual(EXCECOES);
  });

  it('a lista de exceções contém exatamente as duas decididas', () => {
    // Afrouxar o filtro deixaria a próxima exceção entrar sem ninguém decidir.
    // Se este teste precisar mudar, foi porque alguém decidiu — e é o que se
    // quer: a decisão aparece no diff.
    expect(EXCECOES).toEqual(['provider-profile', 'contracts/:id/link']);
  });

  it('salvar template é POST, não PATCH — editar cria versão', () => {
    // As duas rotas de `versions` são GET (histórico) e POST (salvar). O que
    // este teste barra é a terceira: um PATCH que alterasse a versão corrente
    // no lugar, apagando o texto de que um contrato emitido saiu.
    const versions = routes.filter((r) => r.path.includes('versions'));
    expect(versions.map((r) => r.method).sort()).toEqual(
      [RequestMethod.GET, RequestMethod.POST].sort(),
    );
  });
});
