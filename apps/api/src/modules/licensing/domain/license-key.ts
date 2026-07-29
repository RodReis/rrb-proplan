import { createHash, randomInt } from 'node:crypto';

/**
 * A chave de licença (SPEC-036 §Notas técnicas).
 *
 * Formato: `<keyPrefix>-XXXX-XXXX-XXXX-XXXX` — o prefixo vem do `LicProduct`
 * (MVP4 §4), nunca de constante daqui: senão o segundo produto do tenant
 * emitiria chave com o prefixo do primeiro.
 *
 * **A chave é digitada por gente.** É isso que decide o alfabeto: sem `0/O` e
 * sem `1/I`, os pares que ninguém distingue num e-mail de confirmação ou numa
 * fonte de terminal. Um comprador que digita `O` onde havia `0` recebe `404` e
 * abre chamado de suporte — o custo do ambíguo não é teórico.
 *
 * Crypto puro, sem Prisma e sem Nest: a parte da fatia que mais precisa de
 * teste é a que não deve depender de infraestrutura para ser testada.
 */

/**
 * 32 símbolos, sem os ambíguos (`0`, `O`, `1`, `I`). 16 posições × log2(32) =
 * **80 bits** de entropia — muito acima do que a enumeração de chave exige,
 * ainda mais atrás do rate limit do `/activate` (PR-3).
 */
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const GRUPOS = 4;
const CHARS_POR_GRUPO = 4;

/**
 * Chave nova, em claro. **Devolvida uma única vez** pela emissão e nunca
 * persistida — o que vai para o banco é o `hashKey` dela.
 *
 * `randomInt` do `node:crypto` e não `Math.random`: CSPRNG, e a versão com
 * limite superior já é livre de viés de módulo (rejeita e sorteia de novo).
 * Chave previsível aqui é chave que alguém gera sem comprar.
 */
export function generateKey(prefix: string): string {
  const grupos: string[] = [];
  for (let g = 0; g < GRUPOS; g += 1) {
    let grupo = '';
    for (let c = 0; c < CHARS_POR_GRUPO; c += 1) {
      grupo += ALFABETO[randomInt(ALFABETO.length)];
    }
    grupos.push(grupo);
  }
  return [prefix, ...grupos].join('-');
}

/**
 * Hash de armazenamento e de lookup. SHA-256 sem salt **de propósito**: a busca
 * é por hash (`WHERE key_hash = ?`), e um salt por linha obrigaria a varrer a
 * tabela inteira comparando uma a uma — a cada ativação.
 *
 * Seguro aqui, ao contrário de senha: 80 bits de entropia CSPRNG não têm
 * dicionário nem força-bruta viável, e o que o salt protege (segredo humano,
 * previsível, reusado entre serviços) não se aplica. Mesma decisão, e pelo
 * mesmo motivo, do token de briefing (SPEC-029) e de contrato (SPEC-034).
 */
export function hashKey(key: string): string {
  return createHash('sha256').update(normalizeKey(key)).digest('hex');
}

/**
 * Forma canônica antes do hash. Existe porque a chave **é digitada**: o
 * comprador cola com espaço em volta, digita em minúscula, ou o cliente de
 * licença repassa o que veio do campo de texto sem tocar.
 *
 * Sem isto, `wr-ab12-...` e `WR-AB12-...` produziriam hashes diferentes e a
 * segunda daria `404` numa licença que existe — o modo de falhar mais caro
 * desta fatia, porque parece bug do comprador.
 *
 * Só `trim` + `toUpperCase`: **não** removemos hífens nem espaços internos. Um
 * "conserto" mais esperto aceitaria `WRAB12...` e faria a chave ter mais de uma
 * forma válida — e aí `normalizeKey` viraria parte do formato, não a higiene
 * dele.
 */
export function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}

/**
 * A chave tem a forma que `generateKey` produz?
 *
 * Barra lixo antes do banco: sem isto, todo campo vazio ou URL colada por
 * engano vira uma consulta ao índice. Não é validação de segurança — quem
 * decide se a chave existe é o lookup por hash — é o filtro que evita gastar
 * banco com entrada que não pode ser chave nenhuma.
 */
export function isWellFormedKey(key: string, prefix: string): boolean {
  const partes = normalizeKey(key).split('-');
  if (partes.length !== GRUPOS + 1) return false;
  if (partes[0] !== prefix.toUpperCase()) return false;
  return partes
    .slice(1)
    .every(
      (grupo) =>
        grupo.length === CHARS_POR_GRUPO &&
        [...grupo].every((ch) => ALFABETO.includes(ch)),
    );
}

/**
 * Fim da janela de updates: emissão + `updatesMonths` da edição.
 *
 * **Copiado para a licença, nunca lido por FK** (§Contratos): mudar a política
 * comercial meses depois não pode encurtar a janela de quem já comprou.
 *
 * `setUTCMonth` cuida do overflow de ano sozinho. O caso que ele resolve em
 * silêncio e que uma conta em milissegundos erraria: comprar em 31/01 com
 * `updatesMonths = 1` dá 03/03 (fevereiro não tem dia 31) — a favor do
 * comprador, que é o lado certo de arredondar.
 */
export function updatesUntil(from: Date, updatesMonths: number): Date {
  const fim = new Date(from.getTime());
  fim.setUTCMonth(fim.getUTCMonth() + updatesMonths);
  return fim;
}
