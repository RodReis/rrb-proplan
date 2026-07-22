import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (SPEC-022): no `catalog`, todo acesso a tabela ESCOPADA
 * por RLS passa por `withTenant`.
 *
 * Por que só o catalog: as demais rotas são `/t/:tenant/...` e passam pelo
 * `TenantContextInterceptor`, que abre o contexto e o expõe pelo
 * AsyncLocalStorage — lá o `this.prisma.project` já é roteado para o `tx`. O
 * catálogo é a exceção deliberada (ADR-020): é rota GLOBAL, não tem tenant na
 * URL e monta o array de membership no próprio service. Sem interceptor, cada
 * acesso precisa abrir o seu contexto.
 *
 * O bug que esta regra trava (produção, 2026-07-22): `addProject` gravava o
 * projeto sob contexto — mas chamava `enqueueSync` FORA dele. O `enqueueSync`
 * valida o id lendo `projects`; sem contexto o RLS não devolve a linha e a
 * resposta virou "Projeto não encontrado" com o projeto recém-criado no banco.
 * `removeProject` tinha o mesmo defeito, ainda não manifestado — um DELETE que
 * não casaria linha alguma. Corrigir só o call site que doeu deixaria os
 * irmãos quebrados; esta varredura é o que impede a reincidência.
 */

const CATALOG_SERVICE = join(__dirname, 'catalog.service.ts');

/** Tabelas com policy de RLS por tenant (as que o catalog toca). */
const SCOPED_MODELS = ['project', 'syncRun', 'issue', 'document', 'insight'];

describe('arquitetura: catalog (rota global) acessa tabela escopada sob withTenant', () => {
  it('métodos de rota GLOBAL não acessam model escopado pelo client base', () => {
    const src = readFileSync(CATALOG_SERVICE, 'utf-8');

    // `this.prisma.project.…` usa o client BASE. Numa rota escopada isso é
    // legítimo — o Proxy do PrismaService roteia o acesso para o `tx` que o
    // TenantContextInterceptor colocou no AsyncLocalStorage. Numa rota GLOBAL
    // não há `tx` no contexto: o RLS vê contexto vazio (fail-closed) e a query
    // não casa nada. Por isso a regra vale só para os métodos globais.
    const GLOBAL_METHODS = [
      'listInstallations',
      'addProject',
      'removeProject',
      'listProjects',
      // SPEC-028: `/resolve` também é rota global (não tem `:tenant` no path —
      // é o que ela descobre), então abre o próprio contexto como as demais.
      'resolveSlugs',
    ];

    const offenders: string[] = [];
    for (const method of GLOBAL_METHODS) {
      // Corpo do método: do nome até o próximo `\n  async ` / `\n  private ` no
      // mesmo nível de indentação.
      const start = src.indexOf(`async ${method}(`);
      if (start === -1) continue;
      const rest = src.slice(start);
      const end = rest.slice(1).search(/\n {2}(async |private |\/\*\*)/);
      const body = end === -1 ? rest : rest.slice(0, end + 1);

      for (const model of SCOPED_MODELS) {
        if (new RegExp(`this\\.prisma\\.${model}\\.`).test(body)) {
          offenders.push(`${method} → this.prisma.${model}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('enqueueSync do addProject roda dentro de withTenant', () => {
    const src = readFileSync(CATALOG_SERVICE, 'utf-8');

    // O enqueueSync lê `projects` para validar o id. A chamada precisa estar
    // textualmente dentro de um withTenant — caso contrário o projeto nasce e
    // o sync inicial (SPEC-002) nunca é enfileirado.
    const dentroDeWithTenant =
      /withTenant\([^)]*\)?[\s\S]{0,200}?enqueueSync\(/.test(src);

    expect(dentroDeWithTenant).toBe(true);
  });
});
