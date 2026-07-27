import { resolveDevAuthBypass } from './dev-auth-bypass';

/**
 * O bypass de login em DEV (decisão do PI, 2026-07-27).
 *
 * Estes testes existem para uma pergunta só: **produção consegue ligar isto
 * por acidente?** A resposta tem que ser não, por qualquer caminho — variável
 * copiada de um `.env` de dev, config restaurada de backup, deploy mal
 * aplicado. Por isso o primeiro bloco tenta *forçar* o bypass em produção.
 */

const USER = 'ca08cd44-443c-440e-91d5-72f5c996628d';

describe('resolveDevAuthBypass', () => {
  describe('produção recusa, aconteça o que acontecer', () => {
    it('recusa mesmo com a flag ligada e o usuário preenchido', () => {
      // O cenário do acidente: alguém copiou o .env do dev para produção.
      const decision = resolveDevAuthBypass({
        NODE_ENV: 'production',
        DEV_AUTH_BYPASS: 'true',
        DEV_AUTH_USER_ID: USER,
      });

      expect(decision).toEqual({ enabled: false });
      expect(decision.userId).toBeUndefined();
    });

    it('não devolve o userId nem por engano quando recusa', () => {
      const decision = resolveDevAuthBypass({
        NODE_ENV: 'production',
        DEV_AUTH_BYPASS: 'true',
        DEV_AUTH_USER_ID: USER,
      });

      expect(decision.userId).toBeUndefined();
    });
  });

  describe('as três condições são obrigatórias (AND, não OR)', () => {
    it('liga quando as três passam', () => {
      expect(
        resolveDevAuthBypass({
          NODE_ENV: 'development',
          DEV_AUTH_BYPASS: 'true',
          DEV_AUTH_USER_ID: USER,
        }),
      ).toEqual({ enabled: true, userId: USER });
    });

    it('recusa sem a flag — o padrão é login normal', () => {
      expect(
        resolveDevAuthBypass({
          NODE_ENV: 'development',
          DEV_AUTH_USER_ID: USER,
        }),
      ).toEqual({ enabled: false });
    });

    it('recusa com a flag ligada mas sem usuário para assumir', () => {
      expect(
        resolveDevAuthBypass({
          NODE_ENV: 'development',
          DEV_AUTH_BYPASS: 'true',
        }),
      ).toEqual({ enabled: false });
    });

    it('recusa quando o usuário é só espaço em branco', () => {
      expect(
        resolveDevAuthBypass({
          NODE_ENV: 'development',
          DEV_AUTH_BYPASS: 'true',
          DEV_AUTH_USER_ID: '   ',
        }),
      ).toEqual({ enabled: false });
    });
  });

  describe('a flag exige a palavra exata `true`', () => {
    // Para algo que desliga autenticação, permissividade é defeito: quanto
    // mais valores ligam, mais fácil ligar sem querer.
    it.each(['1', 'yes', 'TRUE', 'True', 'sim', 'on', ''])(
      'recusa o valor %p',
      (value) => {
        expect(
          resolveDevAuthBypass({
            NODE_ENV: 'development',
            DEV_AUTH_BYPASS: value,
            DEV_AUTH_USER_ID: USER,
          }),
        ).toEqual({ enabled: false });
      },
    );

    it('tolera espaço em volta do `true` (vem de .env copiado)', () => {
      expect(
        resolveDevAuthBypass({
          NODE_ENV: 'development',
          DEV_AUTH_BYPASS: ' true ',
          DEV_AUTH_USER_ID: USER,
        }),
      ).toEqual({ enabled: true, userId: USER });
    });
  });

  describe('ambientes que não são produção', () => {
    it.each(['development', 'test', undefined])(
      'aceita NODE_ENV=%p quando o resto está configurado',
      (nodeEnv) => {
        expect(
          resolveDevAuthBypass({
            NODE_ENV: nodeEnv,
            DEV_AUTH_BYPASS: 'true',
            DEV_AUTH_USER_ID: USER,
          }).enabled,
        ).toBe(true);
      },
    );
  });
});
