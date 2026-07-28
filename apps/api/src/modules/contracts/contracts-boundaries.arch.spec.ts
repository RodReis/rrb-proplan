import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * As fronteiras do módulo `contracts` (SPEC-034), provadas por varredura
 * estática — o instrumento da casa (`estimates-boundaries`, `tenant-scope`,
 * `llm-public-surface`). A dívida foi nomeada pelo PR-2 no `contracts.module.ts`
 * e é paga aqui.
 *
 * Por que varredura e não confiança no `@Module`: o `exports` do Nest resolve
 * **injeção**, não resolve o import de TypeScript (ADR-027). E `PrismaService` é
 * global — nada impediria o `contracts` de fazer `prisma.estimate.update` ou
 * `prisma.clientStatusTransition.create` direto. Funcionaria hoje, e a fronteira
 * teria desmanchado em silêncio.
 *
 * 1. **Não ESCREVE nas tabelas de outros módulos.** Ler a `Estimate` aprovada e
 *    a `ArtifactVersion` de escopo é o que a emissão faz; gravar naquelas
 *    entidades seria o `contracts` decidindo por um dono que não é ele.
 * 2. **Emitir não move o card** (§2.6) — nenhuma transição de funil sai deste
 *    módulo no PR-3. Quem move para `CONTRACT_PENDING` é a aprovação da
 *    estimativa; quem move para `CONTRACT_APPROVED` é o aceite, no PR-5, e por
 *    dentro do `ClientsService`.
 * 3. **Nada de IA nesta fatia** (§7.4): o contrato é renderização determinística
 *    de template + snapshot. LLM redigindo cláusula é o que o ADR-012 recusa —
 *    auditável por ausência.
 */

const RAIZ = join(__dirname);

/** Todos os `.ts` do módulo, menos os próprios testes. */
function arquivosDoModulo(dir: string = RAIZ): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      out.push(...arquivosDoModulo(caminho));
      continue;
    }
    if (!entrada.endsWith('.ts')) continue;
    if (entrada.endsWith('.spec.ts')) continue;
    out.push(caminho);
  }
  return out;
}

interface Ocorrencia {
  arquivo: string;
  linha: number;
  texto: string;
}

function varrer(padrao: RegExp): Ocorrencia[] {
  const achados: Ocorrencia[] = [];
  for (const arquivo of arquivosDoModulo()) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((texto, i) => {
      // Comentário não é código: a regra é sobre o que executa, e os arquivos
      // deste módulo explicam a fronteira em prosa — incluindo os nomes que a
      // varredura procura.
      const semComentario = texto.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (padrao.test(semComentario)) {
        achados.push({ arquivo: arquivo.replace(RAIZ, ''), linha: i + 1, texto: texto.trim() });
      }
    });
  }
  return achados;
}

const ESCRITAS = '(create|update|upsert|delete|createMany|updateMany|deleteMany)';

describe('contracts: a fronteira com os módulos que ele consome (ADR-001)', () => {
  it('a varredura enxerga os arquivos do módulo — senão passaria vazia', () => {
    // Sem esta âncora, um erro no caminho transformaria os testes abaixo em
    // "nenhum arquivo, logo nenhuma violação": verde e sem valor nenhum.
    expect(arquivosDoModulo().length).toBeGreaterThanOrEqual(6);
  });

  it('não grava em estimates nem em artefatos — só lê', () => {
    const escritas = varrer(
      new RegExp(`prisma\\.(estimate|artifact|artifactVersion|artifactRun)\\.${ESCRITAS}`),
    );
    expect(escritas).toEqual([]);
  });

  it('não grava em clients nem em client_projects', () => {
    const escritas = varrer(new RegExp(`prisma\\.(client|clientProject)\\.${ESCRITAS}`));
    expect(escritas).toEqual([]);
  });
});

describe('contracts: emitir NÃO move o card (§2.6)', () => {
  it('nenhuma transição de funil sai deste módulo', () => {
    // Emitir duas versões do contrato não pode mexer no funil duas vezes. O
    // único ato que move é o aceite (PR-5), e ele pedirá a transição ao
    // `ClientsService` em vez de gravar a linha por conta própria.
    const transicoes = varrer(/prisma\.clientStatusTransition\.|\.transition\(/);
    expect(transicoes).toEqual([]);
  });

  it('nenhum estado do funil é escrito como literal no módulo', () => {
    const estados = varrer(/'(CONTRACT_PENDING|CONTRACT_APPROVED|ARTIFACTS_READY)'/);
    expect(estados).toEqual([]);
  });
});

describe('contracts: nada de IA nesta fatia (§7.4)', () => {
  it('nenhum import do módulo `llm` nem de SDK de modelo', () => {
    // O contrato é renderização determinística de template + snapshot. LLM
    // redigindo cláusula é exatamente o que o ADR-012 e o MVP3 §9 recusam.
    const imports = varrer(/from '.*(llm|anthropic|openai).*'/i);
    expect(imports).toEqual([]);
  });
});
