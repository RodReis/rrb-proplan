import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * As duas fronteiras do módulo `estimates` (SPEC-033 §2), provadas por
 * varredura estática — o instrumento da casa para isso (`tenant-scope`,
 * `batch-transaction`, `llm-public-surface`).
 *
 * Por que varredura e não confiança no `@Module`: o `exports` do Nest resolve
 * **injeção**, não resolve o import de TypeScript (ADR-027, alternativa
 * rejeitada nº 2). E `PrismaService` é global — nada impediria o `estimates` de
 * fazer `prisma.artifactVersion.create` direto. Funcionaria hoje, e a fronteira
 * teria desmanchado em silêncio.
 *
 * 1. **`estimates` não ESCREVE nas tabelas do `artifacts`.** Ler é permitido (a
 *    leitura do painel monta o estado do `effort_breakdown`); gravar passa pelo
 *    `ArtifactsService`, que é o dono daquelas entidades.
 * 2. **`estimates` não fala com o GitHub** (§2.9 e §5: *"nenhuma chamada ao
 *    GitHub neste caminho, auditável por ausência"*). A decomposição em MVPs é
 *    só dado; criar issues reais mudaria a fronteira declarada no MVP3 §3 e pede
 *    ADR próprio.
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

describe('estimates: a fronteira com `artifacts` (ADR-001)', () => {
  it('a varredura enxerga os arquivos do módulo — senão passaria vazia', () => {
    // Sem esta âncora, um erro no caminho transformaria os testes abaixo em
    // "nenhum arquivo, logo nenhuma violação": verde e sem valor nenhum.
    expect(arquivosDoModulo().length).toBeGreaterThanOrEqual(5);
  });

  it('não grava nas tabelas de artefato — quem persiste é o ArtifactsService', () => {
    const escritas = varrer(
      /prisma\.(artifact|artifactVersion|artifactRun)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/,
    );
    expect(escritas).toEqual([]);
  });

  it('não importa entidade interna do `artifacts` além do que é público', () => {
    // `ArtifactsService`, a config do modelo e o `inputHash` são o que o módulo
    // consome — os três já atravessam a fronteira pelo caminho declarado no
    // `estimates.module.ts`. Um import de `artifacts/application/` que NÃO seja
    // o service (por exemplo, o `ArtifactReviewService`) significaria o
    // `estimates` reimplementando revisão em vez de reaproveitá-la.
    const proibidos = varrer(
      /from '\.\.\/\.\.\/artifacts\/(application\/(?!artifacts\.service)|infrastructure\/)/,
    );
    expect(proibidos).toEqual([]);
  });
});

describe('estimates: não fala com o GitHub (§2.9, §5)', () => {
  it('nenhum import de client do GitHub', () => {
    const imports = varrer(/from '.*(github|octokit).*'/i);
    expect(imports).toEqual([]);
  });

  it('nenhuma URL da API do GitHub', () => {
    // A decomposição em MVPs é SÓ DADO. Criar issues no repo do cliente mudaria
    // a fronteira "clients não fala com GitHub" (MVP3 §3) — não é um item de
    // escopo a mais, é decisão de arquitetura que pede ADR.
    const urls = varrer(/api\.github\.com|github\.com\/repos/);
    expect(urls).toEqual([]);
  });
});
