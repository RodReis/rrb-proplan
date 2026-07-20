import { Injectable, Logger } from '@nestjs/common';
import { GithubOrgRole } from '../domain/role-derivation';

const TIMEOUT_MS = 10_000;

/**
 * Papel do usuário numa organização do GitHub (SPEC-022, emenda E2, decisão 1).
 * `GET /orgs/{org}/memberships/{username}` — 1 request por org por recálculo.
 *
 * SEMPRE com o **token do usuário** (ADR-015: leitura nunca com installation
 * token). Aqui isso é duplamente necessário: o endpoint responde sobre a
 * relação DAQUELE usuário com a org — com token de instalação a pergunta nem
 * faria sentido.
 */
@Injectable()
export class GithubOrgMembershipClient {
  private readonly logger = new Logger(GithubOrgMembershipClient.name);

  /**
   * `admin` | `member` quando o usuário é membro ativo; `null` quando não é
   * membro, perdeu acesso, ou a consulta falhou.
   *
   * Falha de rede também devolve `null`, e isso é deliberado: o recálculo de
   * papel roda dentro da listagem do catálogo (decisão 2) e não pode derrubá-la.
   * O chamador trata `null` como "sem acesso" — mas a guarda anti-rebaixamento
   * (decisão 4) impede que uma indisponibilidade transitória do GitHub deixe o
   * tenant sem owner.
   */
  async roleOf(
    userToken: string,
    org: string,
    username: string,
  ): Promise<GithubOrgRole> {
    try {
      const res = await fetch(
        `https://api.github.com/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(username)}`,
        {
          headers: {
            Authorization: `Bearer ${userToken}`,
            Accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );

      // 404 = não é membro (ou a org não é visível para este token): é a
      // resposta ESPERADA de "perdeu o acesso", não um erro.
      if (res.status === 404) return null;
      if (!res.ok) {
        this.logger.warn(`orgs/${org}/memberships respondeu ${res.status}; papel não recalculado`);
        return null;
      }

      const body = (await res.json()) as { state?: string; role?: string };
      // `pending` = convite não aceito. Ainda não tem acesso de fato.
      if (body.state !== 'active') return null;
      return body.role === 'admin' ? 'admin' : 'member';
    } catch (e) {
      this.logger.warn(
        `Falha ao consultar papel na org ${org}: ${e instanceof Error ? e.message : e}`,
      );
      return null;
    }
  }
}
