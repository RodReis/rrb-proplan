/**
 * Token do link de briefing lembrado **nesta aba**, por projeto.
 *
 * O servidor guarda só o SHA-256 do token (SPEC-029 / `briefing-token.ts`), então
 * ele nunca é recuperável por GET. Sem este cache, quem gera o link e fecha a
 * janela sem copiar só tem uma saída: regenerar — invalidando o que já mandou
 * para o cliente. Isso é o defeito relatado.
 *
 * `sessionStorage`, não `localStorage`, **de propósito**: o token é a credencial
 * de acesso ao briefing. Sobreviver ao fechamento do navegador o transformaria em
 * segredo persistido em disco, que é justamente o que o modelo de hash-only
 * evita. Aqui ele morre com a aba — conveniência de sessão, não persistência.
 *
 * O que este cache NÃO faz: valer em outra máquina, aba ou depois de fechar o
 * navegador. Nesses casos a tela volta a dizer que a saída é regenerar, que
 * continua sendo a verdade.
 */
const STORAGE_KEY = 'proplan:briefingTokens';

type TokenMap = Record<string, string>;

function read(): TokenMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Entrada não confiável: só sobrevive o que for {string: string} de verdade.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'string' && v.length > 0,
      ),
    ) as TokenMap;
  } catch {
    // Storage indisponível ou JSON corrompido — a tela cai em "regenerar".
    return {};
  }
}

function write(map: TokenMap): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Sem storage o link só vale enquanto o diálogo estiver aberto. Degrada para
    // o comportamento anterior, não é erro de usuário.
  }
}

/** Guarda o token recém-criado do projeto, substituindo o anterior. */
export function rememberToken(projectId: string, token: string): void {
  write({ ...read(), [projectId]: token });
}

/** Token lembrado nesta sessão, ou `null` se não houver. */
export function recallToken(projectId: string): string | null {
  return read()[projectId] ?? null;
}

/**
 * Esquece o token do projeto. Chamado ao revogar e ao regenerar: manter o antigo
 * ofereceria para cópia uma URL que já não funciona — pior que não oferecer
 * nenhuma, porque o operador só descobre pelo cliente.
 */
export function forgetToken(projectId: string): void {
  const map = read();
  if (!(projectId in map)) return;
  delete map[projectId];
  write(map);
}
