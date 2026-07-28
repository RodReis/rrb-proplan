import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Teste de arquitetura (ADR-027, decisão 3): o módulo `llm` só é consumido pela
 * sua superfície pública — `modules/llm` (o barril `index.ts`). Import profundo
 * a partir de fora quebra o build.
 *
 * Por que isto existe, e por que não bastou mover os arquivos: o `exports` do
 * `@Module` do Nest resolve **injeção de dependência**, não resolve o import de
 * TypeScript. Um módulo `llm` com `exports` correto e imports profundos livres
 * reproduz no endereço novo exatamente a violação do ADR-001 que a extração
 * existe para desfazer — com a agravante de *parecer* resolvido.
 *
 * A regra é verificada por máquina porque regra de fronteira que depende de
 * alguém lembrar sobrevive até o primeiro PR apressado. Mesma disciplina do
 * `tenant-scope.arch.spec.ts` e da auditoria de RLS.
 *
 * O repo não usa ESLint; a varredura estática é o mecanismo de checagem da casa
 * (o ADR-027 pede a regra no CI, não uma ferramenta específica).
 */

const MODULES_DIR = join(__dirname, '..');
const SRC_DIR = join(MODULES_DIR, '..');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (file: string) => file.slice(SRC_DIR.length + 1).replace(/\\/g, '/');

/** Arquivos de fora do módulo `llm` (specs incluídos: teste também acopla). */
function filesOutsideLlm(): string[] {
  return tsFiles(SRC_DIR).filter((f) => !rel(f).startsWith('modules/llm/'));
}

describe('arquitetura: o módulo llm só é consumido pela superfície pública (ADR-027)', () => {
  it('nenhum arquivo de fora importa de llm/application, llm/domain ou llm/infrastructure', () => {
    // Casa tanto o caminho relativo (`../../llm/domain/llm-client`) quanto o
    // absoluto por baseUrl (`modules/llm/domain/...`). O que NÃO casa — de
    // propósito — é `from '../llm'` e `from '../../llm'`: o barril é o caminho
    // legítimo.
    const deepImport =
      /from\s+['"][^'"]*(?:modules\/)?llm\/(?:application|domain|infrastructure|llm\.module)[^'"]*['"]/;

    const offenders = filesOutsideLlm()
      .filter((file) => deepImport.test(readFileSync(file, 'utf-8')))
      .map(rel)
      .sort();

    // A lista de infratores é a própria mensagem de erro: o jest imprime os
    // caminhos, e a correção é sempre a mesma — importar de `modules/llm`.
    expect(offenders).toEqual([]);
  });

  it('o barril existe e exporta o que o módulo promete', () => {
    const barrel = readFileSync(join(MODULES_DIR, 'llm', 'index.ts'), 'utf-8');
    // A lista mínima do ADR-027 decisão 1: porta, fábrica, ledger e gate do
    // teto. Some um destes do barril e algum consumidor vai "resolver" com
    // import profundo — que é o que o caso acima proíbe.
    for (const symbol of [
      'LlmModule',
      'LlmClient',
      'LlmClientFactory',
      'LlmUsageRecorder',
      'UsageService',
    ]) {
      expect(barrel).toContain(symbol);
    }
  });

  it('o llm não importa do insight — a dependência foi invertida', () => {
    // O insight virou cliente do llm. Se o llm voltar a olhar para dentro do
    // insight, a extração se desfaz em silêncio e os dois módulos voltam a
    // subir juntos.
    const importsInsight = /from\s+['"][^'"]*insight\//;
    const offenders = tsFiles(join(MODULES_DIR, 'llm'))
      .filter((file) => importsInsight.test(readFileSync(file, 'utf-8')))
      .map(rel)
      .sort();
    expect(offenders).toEqual([]);
  });
});
