import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceClient,
  GithubSourceError,
} from '../infrastructure/github-source.client';
import {
  latestAuthorized,
  latestOverall,
} from '../domain/release-authorization';
import { LicenseActivationService } from './license-activation.service';

/**
 * `POST /licensing/v1/releases/check` (SPEC-041 §Contratos) — *"há versão nova
 * para mim?"*.
 *
 * ## Barata e idempotente, ao contrário do `download`
 *
 * São duas rotas justamente por isso (§Notas técnicas): esta responde sem falar
 * com o GitHub e pode ser chamada à vontade; a do PR-3 cunha URL assinada de vida
 * curta a cada chamada, e por isso não pode ser cacheada. Fundi-las obrigaria a
 * pedir URL nova só para perguntar se há update — e a URL expiraria antes de o
 * usuário clicar em "atualizar".
 *
 * ## Não escreve nada
 *
 * Nenhum `lastSeenAt`, nenhum `LicEvent`. Perguntar se há atualização não é sinal
 * de vida (o `heartbeat` é quem governa isso) e não é download (o `LicEvent` de
 * auditoria nasce no PR-3, quando o cliente de fato leva o binário). Registrar
 * aqui encheria a trilha de linhas de "perguntou" e afogaria as de "baixou", que
 * são as que respondem *quem levou o quê*.
 */

export interface ReleaseCheckInput {
  licenseKey?: unknown;
  fingerprint?: unknown;
  /** O que o cliente tem instalado hoje. Opcional — ver `update: false`. */
  currentVersion?: unknown;
}

export type ReleaseCheckResult =
  | { update: false }
  | {
      update: true;
      version: string;
      releasedAt: string;
      sha256: string;
      notes: string | null;
      /**
       * `current` — é a release mais nova que existe.
       * `last-authorized` — há mais nova, fora da janela de updates desta licença.
       *
       * O cliente precisa da distinção para oferecer renovação sem mentir: sem
       * ela, "você está atualizado" sairia para quem na verdade parou de receber
       * versões.
       */
      reason: 'current' | 'last-authorized';
    };

export interface ReleaseDownloadInput {
  licenseKey?: unknown;
  fingerprint?: unknown;
  version?: unknown;
  os?: unknown;
}

export interface ReleaseDownloadResult {
  /** URL assinada do storage do GitHub. Vale segundos — não cachear. */
  url: string;
  /**
   * Declarado, não medido. O GitHub não diz na resposta quanto a URL dura, e
   * inventar um número exato seria afirmar o que não se sabe. O valor existe
   * para o cliente saber que precisa baixar **agora**, não para agendar nada.
   */
  expiresInSeconds: number;
  /** O mesmo do `check` — o cliente confere depois de baixar. */
  sha256: string;
}

/** Campo livre vindo de fora, sem sessão. */
const MAX_FINGERPRINT = 128;
const MAX_VERSION = 64;
const MAX_OS = 32;

/**
 * O que se promete ao cliente sobre a validade da URL. A do GitHub costuma
 * durar poucos minutos; o número menor é deliberado — prometer a mais faria o
 * cliente tentar um link já morto e ler como "download corrompido".
 */
const URL_TTL_SECONDS = 60;

@Injectable()
export class LicenseReleaseService {
  private readonly logger = new Logger(LicenseReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activation: LicenseActivationService,
    private readonly github: GithubSourceClient,
    private readonly crypto: CryptoService,
  ) {}

  async check(input: ReleaseCheckInput): Promise<ReleaseCheckResult> {
    const licenseKey = texto(input.licenseKey);
    const fingerprint = texto(input.fingerprint);

    if (!licenseKey || !fingerprint) {
      throw new UnprocessableEntityException(
        '`licenseKey` e `fingerprint` são obrigatórios',
      );
    }
    if (fingerprint.length > MAX_FINGERPRINT) {
      throw new UnprocessableEntityException('`fingerprint` longo demais');
    }

    const currentVersion = texto(input.currentVersion).slice(0, MAX_VERSION);

    // O gate compartilhado: `404` chave inexistente, `410` revogada/expirada/
    // inadimplente, `409` fingerprint não ativo. Vem do serviço de ativação de
    // propósito — é o mesmo gate do `/heartbeat`, não uma segunda opinião.
    const licenca = await this.activation.licencaParaUpdate(licenseKey, fingerprint);

    return this.prisma.runInTenantContext([licenca.tenant_id], async () => {
      const releases = await this.prisma.licRelease.findMany({
        where: {
          productId: licenca.product_id,
          // **Despublicada some do `check` E do `download`** (§Critérios de
          // aceite). Filtrar aqui, e não na decisão, é o que garante que ela nem
          // participe da escolha do "mais novo": uma release retirada por defeito
          // não pode virar a resposta nem sequer como `last-authorized`.
          published: true,
        },
        select: {
          version: true,
          releasedAt: true,
          sha256: true,
          notes: true,
        },
      });

      const autorizada = latestAuthorized(releases, licenca.updates_until);

      // Nenhuma release autorizada: nem a mais antiga cabe na janela desta
      // licença. `update: false` é a resposta honesta — não há o que oferecer.
      if (!autorizada) return { update: false };

      // O cliente já está na versão autorizada mais nova. Comparação por
      // igualdade de string, não por semver: `version` é o identificador que o
      // admin registrou e que o instalador carrega — inventar ordenação semver
      // aqui criaria uma segunda noção de "mais novo", divergente do
      // `releasedAt` que a autorização usa.
      if (currentVersion && currentVersion === autorizada.version) {
        return { update: false };
      }

      const maisNovaQueExiste = latestOverall(releases);

      return {
        update: true,
        version: autorizada.version,
        releasedAt: autorizada.releasedAt.toISOString(),
        sha256: autorizada.sha256,
        notes: autorizada.notes,
        reason:
          maisNovaQueExiste && maisNovaQueExiste.version !== autorizada.version
            ? 'last-authorized'
            : 'current',
      };
    });
  }

  /**
   * `POST /licensing/v1/releases/download` (SPEC-041 §Contratos) — troca
   * `(licença, versão, os)` por **URL assinada de vida curta**.
   *
   * ## Nenhum byte do artefato passa por aqui
   *
   * É critério de aceite, e o que o garante mora no cliente do GitHub
   * (`redirect: 'manual'`), não neste método: o que sobe é o `Location` do `302`,
   * e o binário vai do storage do GitHub direto para a máquina do comprador.
   *
   * ## A versão vem do cliente, e por isso é reautorizada aqui
   *
   * O `check` já disse qual versão está autorizada — mas quem chama esta rota é
   * um binário na máquina de outra pessoa, e nada obriga a mandar de volta o que
   * o `check` respondeu. Confiar na resposta anterior deixaria o cliente pedir
   * **qualquer** versão: bastaria trocar o campo para baixar o que a janela de
   * updates não cobre. A autorização é refeita do zero, com a mesma função pura.
   *
   * ## Erros de configuração nunca viram `500`
   *
   * PAT ausente, ilegível, expirado ou sem `contents:read` respondem `503` com
   * motivo legível (§Critérios de aceite). O modo de errar aqui é mudo por
   * natureza — a máquina do cliente para de receber update e ninguém no admin
   * fica sabendo —, então o mínimo é que o erro **diga o que é** para quem o
   * receber, e que ele apareça no log do servidor com o tenant nomeado.
   */
  async download(input: ReleaseDownloadInput): Promise<ReleaseDownloadResult> {
    const licenseKey = texto(input.licenseKey);
    const fingerprint = texto(input.fingerprint);
    const version = texto(input.version).slice(0, MAX_VERSION);
    const os = texto(input.os).slice(0, MAX_OS);

    if (!licenseKey || !fingerprint || !version || !os) {
      throw new UnprocessableEntityException(
        '`licenseKey`, `fingerprint`, `version` e `os` são obrigatórios',
      );
    }
    if (fingerprint.length > MAX_FINGERPRINT) {
      throw new UnprocessableEntityException('`fingerprint` longo demais');
    }

    // Mesmo gate das outras rotas: 404 / 409 / 410. Não é cópia — é o método do
    // serviço de ativação. Uma segunda opinião aqui serviria update a licença
    // revogada, que é o reembolsado continuando a receber versões novas.
    const licenca = await this.activation.licencaParaUpdate(licenseKey, fingerprint);

    const { release, repo } = await this.prisma.runInTenantContext(
      [licenca.tenant_id],
      async () => {
        const alvo = await this.prisma.licRelease.findFirst({
          where: {
            productId: licenca.product_id,
            version,
            os,
            // Despublicada some do `download` também (§Critérios de aceite) — e
            // some como `404`, não como `403`: quem despublicou por defeito não
            // deve informar a quem pergunta que a versão existe.
            published: true,
          },
          select: { id: true, version: true, releasedAt: true, sha256: true, assetId: true },
        });
        if (!alvo) {
          throw new NotFoundException('release não encontrada para esta versão e plataforma');
        }

        // **A autorização, refeita.** `latestAuthorized` responde "a mais nova
        // que cabe na janela"; aqui a pergunta é sobre UMA release, então a regra
        // é aplicada direto — mesma comparação (`>=`, contra o `updatesUntil` DA
        // LICENÇA, nunca o da edição), sem uma segunda noção do que é autorizado.
        if (alvo.releasedAt.getTime() > licenca.updates_until.getTime()) {
          throw new ForbiddenException(
            'esta versão saiu depois do fim da sua janela de atualizações',
          );
        }

        // O repo vem do produto DESTA release, não do primeiro produto do tenant
        // com `sourceRepo`. O caminho do convite (SPEC-039) resolve por tenant
        // porque o piloto tem um produto só; aqui existe `productId` na mão, e
        // usar o do tenant baixaria o asset do repo errado no dia em que houver
        // dois produtos — com o PAT alcançando os dois, sem erro nenhum.
        const produto = await this.prisma.licProduct.findUnique({
          where: { id: licenca.product_id },
          select: { sourceRepo: true },
        });
        if (!produto?.sourceRepo) {
          throw new ServiceUnavailableException(
            'produto sem `sourceRepo` configurado — o download não tem origem',
          );
        }

        return { release: alvo, repo: produto.sourceRepo };
      },
    );

    const pat = await this.patDoTenant(licenca.tenant_id);
    const url = await this.urlAssinada(pat, repo, release.assetId, licenca.tenant_id);

    // O `LicEvent` **depois** da URL cunhada, e só no caminho autorizado: a
    // trilha responde *quem levou o quê*, e registrar antes marcaria como
    // baixado o download que o GitHub recusou. Não grava a URL — ela morre em
    // segundos e guardá-la encheria a trilha de segredo de vida curta.
    await this.prisma.runInTenantContext([licenca.tenant_id], () =>
      this.prisma.licEvent.create({
        data: {
          tenantId: licenca.tenant_id,
          licenseId: licenca.id,
          type: 'release_downloaded',
          payload: { version: release.version, os, releaseId: release.id },
        },
      }),
    );

    return { url, expiresInSeconds: URL_TTL_SECONDS, sha256: release.sha256 };
  }

  /**
   * O PAT do tenant, em claro. `503` com motivo quando falta ou não abre.
   *
   * **Cada desfecho tem mensagem própria de propósito**: "não configurado" e
   * "ilegível" pedem ações diferentes do operador (gravar o token vs. gravar de
   * novo porque a chave de cifra mudou), e um motivo genérico o faria tentar a
   * errada primeiro. O valor **nunca** entra em log, nem no erro.
   *
   * **A leitura roda dentro do contexto de tenant, e o int-spec pegou isto.** Eu
   * a escrevi fora: `lic_settings` tem RLS, a rota é pública e sem sessão, e sem
   * o contexto o `findUnique` devolve `null` **sem erro** (fail-closed). O
   * sintoma seria todo download respondendo *"o servidor não tem acesso ao
   * repositório"* com o PAT gravado e correto — e o operador conferindo a
   * configuração certa, repetidamente, atrás de um defeito que está aqui. É o
   * mesmo fail-closed que o `check` já tratava na busca de releases.
   */
  private async patDoTenant(tenantId: string): Promise<string> {
    const settings = await this.prisma.runInTenantContext([tenantId], () =>
      this.prisma.licSettings.findUnique({
        where: { tenantId },
        select: { githubPat: true },
      }),
    );
    if (!settings?.githubPat) {
      this.logger.error(`Tenant ${tenantId}: download de release sem PAT configurado`);
      throw new ServiceUnavailableException(
        'o servidor de licenças não tem acesso ao repositório de releases configurado',
      );
    }

    try {
      return this.crypto.decrypt(settings.githubPat);
    } catch {
      this.logger.error(`Tenant ${tenantId}: PAT de source ilegível no download de release`);
      throw new ServiceUnavailableException(
        'a credencial de acesso ao repositório de releases está ilegível',
      );
    }
  }

  /**
   * Chama o GitHub e converte a falha em `503` legível.
   *
   * **Traduzir o status do GitHub em status nosso seria mentir**: um `404` de lá
   * (asset fora do alcance do PAT) virando `404` daqui diria ao cliente
   * *"essa release não existe"* sobre uma que existe e está registrada — e o
   * comprador reportaria versão inexistente enquanto o defeito é o escopo do
   * token. Tudo que é falha nossa de configuração sai como `503`, com o motivo do
   * GitHub preservado no texto.
   */
  private async urlAssinada(
    pat: string,
    repo: string,
    assetId: string,
    tenantId: string,
  ): Promise<string> {
    try {
      return await this.github.assetDownloadUrl(pat, repo, assetId);
    } catch (erro) {
      const motivo = erro instanceof GithubSourceError ? erro.message : 'falha ao falar com o GitHub';
      // O log é onde o operador descobre — a máquina do cliente só vê o 503.
      this.logger.error(`Tenant ${tenantId}: download de release falhou — ${motivo}`);
      throw new ServiceUnavailableException(`não foi possível preparar o download: ${motivo}`);
    }
  }
}

/** Normaliza entrada não-confiável: só string vira texto, o resto vira vazio. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
