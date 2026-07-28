import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { EstimatesController } from '../../estimates/presentation/estimates.controller';
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

/**
 * Rotas de alteração-no-lugar permitidas, **por nome** (SPEC-033 §2.6).
 *
 * A regra que este arquivo protege é sobre **conteúdo versionado**:
 * `ArtifactVersion` e `BriefingVersion` são imutáveis, e editar cria versão.
 * `tenant-settings` é **configuração de workspace**, não conteúdo — o valor/hora
 * corrente é um só, e cada `Estimate` já guarda o seu snapshot (SPEC-033 PR-1),
 * que é o que preserva a conta de uma proposta já enviada. Versionar a config
 * além disso guardaria a mesma história duas vezes.
 *
 * A lista é nominal de propósito: afrouxar o filtro por padrão genérico (por
 * exemplo, "PATCH pode se não tiver `versions` no caminho") deixaria a próxima
 * exceção entrar sem ninguém decidir. Aqui, acrescentar um item é uma linha de
 * diff que se lê.
 */
const EXCECOES = ['tenant-settings'];

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
  // O `EstimatesController` (SPEC-033) entra na mesma varredura porque grava
  // versões do `effort_breakdown` nas MESMAS tabelas. Deixá-lo de fora faria a
  // garantia valer só para o controller que já a respeitava — e a rota nova
  // seria exatamente onde a imutabilidade se perderia sem ninguém notar.
  const routes = routesOf([ArtifactsController, EstimatesController]);

  it('a varredura encontra rotas — senão o teste passaria vazio', () => {
    // Sem esta âncora, um erro na leitura dos metadados transformaria o teste
    // abaixo em "nenhuma rota, logo nenhuma escrita": verde e sem valor.
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  it('nenhuma rota de escrita destrutiva no módulo', () => {
    const offending = routes
      .filter((r) => WRITE_METHODS.has(r.method))
      .filter((r) => !EXCECOES.some((e) => r.path.endsWith(e)));

    expect(offending).toEqual([]);
  });

  it('a exceção é nominal e mínima — só configuração, nunca conteúdo', () => {
    // A lista existe para ser lida, não para crescer sem discussão. Se alguém
    // acrescentar um caminho aqui, o diff mostra exatamente o quê — que é o
    // oposto de afrouxar o filtro genérico e a exceção passar despercebida.
    expect(EXCECOES).toEqual(['tenant-settings']);
  });

  it('editar é POST em .../versions — nada é alterado no lugar', () => {
    // O verbo carrega a regra (§6): "não é `PATCH`: nada é alterado no lugar".
    // Quem lê a rota vê que uma versão NASCE.
    const edicao = routes.find((r) => r.path.endsWith('artifacts/:id/versions'));

    expect(edicao).toBeDefined();
    expect(edicao!.method).toBe(RequestMethod.POST);
  });

  it('as leituras são GET', () => {
    // Rota sob `client-projects` que NÃO termina numa ação explícita
    // (`/generate`, `/approve`…) é leitura de estado, e leitura é GET. O
    // filtro por ação existe desde a SPEC-033: `POST
    // .../effort-breakdown/generate` mora sob o mesmo prefixo e é escrita
    // legítima — enfileira um job. Sem o recorte, a asserção passaria a
    // proibir toda escrita sob `client-projects`, que não é o que ela quer
    // dizer.
    const ACOES = ['/generate', '/approve', '/reject'];
    const leituras = routes.filter(
      (r) => r.path.includes('client-projects') && !ACOES.some((a) => r.path.endsWith(a)),
    );

    expect(leituras.length).toBeGreaterThan(0);
    expect(leituras.every((r) => r.method === RequestMethod.GET)).toBe(true);
  });
});
