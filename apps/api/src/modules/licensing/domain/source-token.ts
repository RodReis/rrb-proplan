import { createHash, randomBytes } from 'node:crypto';

/**
 * Token do link de coleta de username (SPEC-039 §Escopo → Coleta do username).
 *
 * Mesma mecânica do token de briefing (SPEC-029) e de contrato (SPEC-034), e
 * **de propósito duplicada**: a arch-spec de fronteira proíbe o `licensing`
 * importar entidade interna de outro módulo. São ~20 linhas de crypto puro; o
 * acoplamento custaria mais.
 *
 * O token é **opaco**: não carrega claims, não é JWT. Quem tem o link tem
 * acesso, então o segredo é o próprio valor — ele existe no e-mail do comprador,
 * é exibido uma única vez na criação e só o **hash** persiste. Vazamento do banco
 * não entrega link ativo.
 *
 * ## Este token vale mais que os outros dois
 *
 * O do briefing leva um formulário; o do contrato leva um documento para ler.
 * Este **concede acesso a código-fonte privado**: quem tiver a URL grava o
 * próprio username e é convidado ao repositório. As mitigações são três e
 * nenhuma elimina o risco (§Notas técnicas): uso único, confirmação com avatar
 * e e-mail nomeando quem será convidado. O que sobra é risco aceito — e-mail
 * comprometido é acesso comprometido, o mesmo que vale para recuperação de senha.
 *
 * Crypto puro, sem Prisma e sem Nest: a parte da fatia que mais precisa de teste
 * é a que não deve depender de infraestrutura para ser testada.
 */

/** 32 bytes = 256 bits de entropia — mesmo tamanho dos outros dois links. */
const TOKEN_BYTES = 32;

/** Token novo, em base64url — seguro em URL sem escape. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash de armazenamento/lookup. SHA-256 sem salt **de propósito**: o lookup é
 * por hash (`WHERE token_hash = ?`), e um salt por linha exigiria varrer a
 * tabela comparando um a um. Seguro aqui, ao contrário de senha: o token tem 256
 * bits de entropia CSPRNG, então não há dicionário nem força-bruta viável — o
 * que o salt protege (senha humana, previsível) não se aplica.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Estado do link, do ponto de vista de quem abre a URL pública.
 *
 * **Três estados, não quatro.** Não existe `expired`: o link não tem prazo
 * (decisão PI #3). Prazo curto trocaria um risco raro (link vazado) por um
 * problema frequente — o comprador que responde no dia 10 e encontra link morto,
 * na venda mais cara do catálogo, já pago e sem o que comprou. A janela fecha no
 * evento que importa (o uso), não num relógio que não sabe nada sobre o
 * comprador.
 */
export type SourceLinkStatus = 'valid' | 'used' | 'invalid';

export interface SourceLinkLifecycle {
  usedAt?: Date | null;
}

/**
 * Estado do link.
 *
 * `used` e `invalid` são **distintos de propósito**, e é o único ponto em que
 * esta rota não é não-diferencial: o critério de aceite exige que reabrir o
 * próprio link mostre **"já utilizado"**, nunca o formulário de novo. Sem essa
 * distinção, quem informou o username e recarregou a página veria o formulário
 * vazio e informaria de novo — ou concluiria que o primeiro envio não funcionou.
 *
 * O que continua indistinguível são **inexistente e de outro tenant**: os dois
 * chegam aqui como `null`, porque a `resolve_source_link` não encontra nenhum dos
 * dois. É o critério não-diferencial das SPEC-029/031 preservado onde ele
 * protege — na enumeração de tokens.
 */
export function sourceLinkStatus(
  link: SourceLinkLifecycle | null,
): SourceLinkStatus {
  if (!link) return 'invalid';
  if (link.usedAt) return 'used';
  return 'valid';
}

/**
 * O username do GitHub é sintaticamente válido?
 *
 * Regra do próprio GitHub: 1–39 caracteres alfanuméricos ou hífen, sem hífen no
 * início ou fim e sem hífen duplo. Validar **antes** da chamada de rede não é
 * otimização: é o que impede que `../../admin` ou `foo bar` sejam interpolados
 * numa URL de API. A confirmação de que o login **existe** é outra coisa, e
 * acontece na GitHub API — validar sintaxe não valida identidade, e validar
 * existência não valida que é o comprador (daí a confirmação por avatar).
 */
export function isValidGithubUsername(username: string): boolean {
  return /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/.test(username);
}
