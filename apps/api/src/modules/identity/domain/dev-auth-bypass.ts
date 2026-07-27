/**
 * Bypass de login para DESENVOLVIMENTO LOCAL (decisão do PI, 2026-07-27).
 *
 * Existe por um motivo concreto: o app do Google está em modo *Testing* no
 * Console, e o consent screen recusa quem não está na lista de usuários de
 * teste ("Acesso bloqueado"). Isso trava o dev local por configuração externa
 * ao repositório — nada que um deploy nosso conserte.
 *
 * Regra pura, sem Nest e sem HTTP, porque é uma **regra de segurança**: ela
 * decide quando a autenticação inteira é dispensada, e uma decisão dessas
 * precisa ser testável sem subir servidor.
 *
 * ## As três condições — todas obrigatórias, com AND
 *
 * 1. `DEV_AUTH_BYPASS=true` — explícito. Nunca liga sozinho.
 * 2. `NODE_ENV !== 'production'` — o ambiente de produção recusa **mesmo que a
 *    variável esteja ligada por engano**. É a trava que não depende de
 *    ninguém lembrar de desligar a flag no deploy.
 * 3. `DEV_AUTH_USER_ID` preenchido — o bypass assume a identidade de um usuário
 *    REAL do banco local. Sem id não há quem assumir, e inventar um usuário
 *    sintético criaria uma conta sem tenant que quebraria as rotas `/t/:tenant`
 *    de um jeito confuso.
 *
 * ## Por que produção é checada aqui e não só no `.env`
 *
 * Confiar apenas na ausência da variável em produção deixaria o sistema seguro
 * *por configuração*. Uma variável copiada por engano de um `.env` de dev, um
 * `railway variables` mal aplicado, um restore de backup de config — qualquer um
 * desses abriria a API inteira. Com o `NODE_ENV` no AND, o pior caso vira um
 * bypass que **não funciona**, em vez de um bypass que funciona sem que ninguém
 * perceba.
 */

export interface BypassEnv {
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_USER_ID?: string;
  NODE_ENV?: string;
}

export interface BypassDecision {
  /** `true` só quando as três condições passam. */
  enabled: boolean;
  /** Usuário a assumir. Presente somente quando `enabled`. */
  userId?: string;
}

/**
 * `'true'` exato, minúsculo, sem espaço em volta depois do trim.
 *
 * Não aceitamos `1`, `yes` ou `TRUE`: para uma flag que desliga autenticação,
 * a permissividade é o defeito. Quanto mais valores ligam, mais fácil ligar sem
 * querer — e o custo de exigir a palavra exata é digitar cinco letras.
 */
function isTrue(value: string | undefined): boolean {
  return value?.trim() === 'true';
}

export function resolveDevAuthBypass(env: BypassEnv): BypassDecision {
  // Produção primeiro: é a condição que não pode ser contornada por nenhuma
  // combinação das outras duas.
  if (env.NODE_ENV === 'production') return { enabled: false };
  if (!isTrue(env.DEV_AUTH_BYPASS)) return { enabled: false };

  const userId = env.DEV_AUTH_USER_ID?.trim();
  if (!userId) return { enabled: false };

  return { enabled: true, userId };
}
