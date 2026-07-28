import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../shared/canonical-json';
import { ARTIFACT_KINDS, type ArtifactKind } from './artifact-kind';

/**
 * Impressão digital do **insumo** de uma capacidade — a chave da idempotência
 * do gatilho automático (SPEC-032 §2.8).
 *
 * O que ela compra: o job rodando duas vezes para a mesma `BriefingVersion`
 * (retry da fila, evento entregue em duplicata, reprocesso manual) colide no
 * índice parcial `(artifact_id, input_hash) WHERE author = 'ai'` em vez de
 * gerar o mesmo artefato de novo — pagando o modelo duas vezes pela mesma
 * resposta.
 *
 * ## O que entra no hash, e por que cada parte
 *
 * - **`answers`** — o conteúdo do briefing. Serializado por `canonicalJson`,
 *   porque a ordem das chaves segue a inserção e as respostas chegam etapa por
 *   etapa (a mesma armadilha que o `contentHash` da SPEC-031 já pagou).
 * - **`kind`** — sem ele, as 4 capacidades sobre o mesmo briefing teriam hashes
 *   idênticos. Elas vivem em artefatos diferentes, então o único não colidiria
 *   — mas o hash deixaria de significar "este insumo" e passaria a significar
 *   "este briefing", e a primeira consulta por hash devolveria quatro linhas.
 * - **`promptVersion`** — mudar o prompt muda a saída esperada. Sem ele, um
 *   prompt corrigido devolveria o artefato velho do índice e a correção não
 *   teria efeito nenhum: o pior tipo de bug, o que se parece com sucesso.
 * - **`upstream`** — a saída das capacidades anteriores, quando a capacidade
 *   consome (o `scope` lê o `normalize`, e assim por diante). Sem isso, corrigir
 *   à mão o `normalize` e regenerar o `scope` devolveria o `scope` antigo.
 *
 * O que **não** entra: o modelo. A decisão do PI é modelo único (Haiku, do env,
 * §2.4), então incluí-lo hoje seria hashear uma constante; e quando houver
 * troca de modelo, ela é motivo de regenerar deliberadamente, não de invalidar
 * cache em silêncio.
 */
export interface ArtifactInput {
  kind: ArtifactKind;
  promptVersion: string;
  /** As respostas da `BriefingVersion` — imutáveis (SPEC-031 §5). */
  answers: unknown;
  /**
   * Saídas das capacidades anteriores que esta consome, por `kind`. Vazio na
   * primeira da cadeia (`normalize`, que lê só o briefing).
   */
  upstream?: Partial<Record<ArtifactKind, unknown>>;
}

/**
 * SHA-256 do insumo canonicalizado.
 *
 * Sem salt, como o `contentHashOf` e o `hashToken`: não é segredo a proteger, é
 * chave de comparação. O que se quer é que insumo igual dê hash igual —
 * exatamente o oposto do que um salt faria.
 */
export function inputHashOf(input: ArtifactInput): string {
  // O objeto é montado com chaves fixas em vez de repassar `input` inteiro: um
  // campo novo no tipo passaria a mudar todos os hashes existentes sem que
  // ninguém tivesse decidido isso. Aqui, incluir algo no hash é um ato
  // explícito — e quebrar a idempotência de propósito é diferente de quebrá-la
  // por descuido.
  return createHash('sha256')
    .update(
      canonicalJson({
        kind: input.kind,
        promptVersion: input.promptVersion,
        answers: input.answers,
        // Normalizado para `{}` quando ausente: `undefined` some no
        // `canonicalJson`, então `{upstream: undefined}` e `{}` já dariam o
        // mesmo hash — explicitar evita que a equivalência dependa desse
        // detalhe do serializador.
        upstream: input.upstream ?? {},
      }),
    )
    .digest('hex');
}

/**
 * Ordem de execução das capacidades (§2.3). Cada uma consome a saída das
 * anteriores, então a ordem é contrato, não preferência.
 */
export const CAPABILITY_ORDER: readonly ArtifactKind[] = ARTIFACT_KINDS;
