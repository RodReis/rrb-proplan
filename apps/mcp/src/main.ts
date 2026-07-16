/**
 * Servidor MCP local do ProPlan (SPEC-016, Fatia 11) — stdio.
 *
 * Entry ESM ISOLADO, fora do build CJS do Nest: o `@modelcontextprotocol/sdk` é
 * ESM-only e reintroduzi-lo no build CJS repetiria o conflito que barrou o
 * Octokit (CLAUDE.md). Aqui o SDK vive num pacote `type: module` próprio e
 * consome os services do ProPlan IN-PROCESS via `createApplicationContext` —
 * sem HTTP, sem porta, sem duplicar acesso a banco fora dos módulos
 * (§Empacotamento). Todo julgamento vem do `McpToolsService` (adaptador fino,
 * ADR-001); este arquivo só é o protocolo. Sem auth no MVP (decisão 1 do PI).
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
// Tudo vem do barrel da api (CJS) — instância única de @nestjs/*. Importar
// @nestjs/core aqui carregaria uma segunda cópia e o DI quebra (ver bootstrap).
import { createMcpContext, McpToolsService } from '@proplan/api/dist/mcp-bootstrap.js';

/** Views de resource (§5) → método do adaptador. Sem `kanban` (ADR-017). */
const RESOURCE_VIEWS: Record<string, (t: McpToolsService, o: string, r: string) => Promise<unknown>> = {
  overview: (t, o, r) => t.explainProject(o, r),
  state: (t, o, r) => t.getProjectState(o, r),
  architecture: (t, o, r) => t.entityView(o, r, 'architecture'),
  risks: (t, o, r) => t.findBlockers(o, r),
  tests: (t, o, r) => t.entityView(o, r, 'testing'),
  deploy: (t, o, r) => t.entityView(o, r, 'deploy'),
  constraints: (t, o, r) => t.getConstraints(o, r),
};

const repoArgs = { owner: z.string(), repo: z.string() };

/** Serializa o ToolResult (Answer | Refusal) — sempre JSON, o contrato inteiro
 *  na resposta (answer/confidence/evidence/refusal), para o agente ver a prova. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

async function main() {
  const tools = await createMcpContext();

  const server = new McpServer({ name: 'proplan', version: '0.1.0' });

  const tool = (
    name: string,
    description: string,
    fn: (o: string, r: string) => Promise<unknown>,
  ) =>
    server.registerTool(
      name,
      { description, inputSchema: repoArgs },
      async ({ owner, repo }) => asContent(await fn(owner, repo)),
    );

  // As 6 perguntas do agente (MVP2 §4). Cada resposta carrega evidência datada;
  // sem evidência, o adaptador já devolveu `refusal` (contrato, §2).
  tool('get_project_state', 'Onde o projeto parou — julgamento com confiança e proveniência por campo.', (o, r) => tools.getProjectState(o, r));
  tool('get_next_task', 'Qual issue pegar agora — combina board, restrições (o fosso) e confiança. Referencia número+URL, nunca reproduz a issue.', (o, r) => tools.getNextTask(o, r));
  tool('get_handoff_context', 'Que arquivos ler, o que é fato × inferência × asserção — o contexto de retomada.', (o, r) => tools.getHandoffContext(o, r));
  tool('get_constraints', 'O que NÃO mexer — asserções humanas da Fatia 10, com a marca a-revalidar sempre presente.', (o, r) => tools.getConstraints(o, r));
  tool('explain_project', 'Resumo do projeto com procedência, para o agente se situar.', (o, r) => tools.explainProject(o, r));
  tool('find_blockers', 'O que trava cada frente — restrições a-revalidar e decisões ausentes.', (o, r) => tools.findBlockers(o, r));

  // Resources: projeções read-only sobre o MESMO material (§5). Sem kanban.
  server.registerResource(
    'proplan-repo',
    new ResourceTemplate('proplan://repo/{owner}/{repo}/{view}', { list: undefined }),
    { title: 'Projeção do ProPlan', mimeType: 'application/json' },
    async (uri, { owner, repo, view }) => {
      const fn = RESOURCE_VIEWS[String(view)];
      const payload = fn
        ? await fn(tools, String(owner), String(repo))
        : { error: `view desconhecida: ${String(view)}` };
      return { contents: [{ uri: uri.href, text: JSON.stringify(payload, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout é o canal do protocolo — logs vão para stderr.
  console.error('ProPlan MCP server rodando (stdio) — 6 tools + resources.');
}

main().catch((err) => {
  console.error('Falha fatal no MCP server:', err);
  process.exit(1);
});
