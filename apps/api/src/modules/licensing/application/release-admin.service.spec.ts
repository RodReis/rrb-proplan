import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceError,
  type GithubAsset,
  type GithubSourceClient,
} from '../infrastructure/github-source.client';
import { ReleaseAdminService } from './release-admin.service';

/**
 * Admin das releases (SPEC-041 §Escopo item 2).
 *
 * O que se prova aqui é **validação no servidor**: os CHECKs do PR-1 recusariam
 * quase tudo isto, mas com `23514`, que a tela mostra como `500` — *"o ProPlan
 * quebrou"* sobre um erro que é *"você digitou o hash errado"*. Foi o FIX #216.
 */

const SHA = 'a'.repeat(64);

/** O asset que o GitHub descreve no caso feliz — hash igual ao digitado. */
const ASSET: GithubAsset = {
  name: 'war-room-setup-1.2.0-win-x64.exe',
  size: 36_314_455,
  sha256: SHA,
};

const VALIDO = {
  productId: 'prod-1',
  version: '1.2.0',
  os: 'win-x64',
  releasedAt: '2026-06-01T00:00:00.000Z',
  assetId: '12345',
  sha256: SHA,
};

/**
 * `existente` serve a DOIS caminhos que chamam o mesmo `findFirst`: no `create`
 * ele responde *"esta versão já está registrada?"* (e `null` é o caso feliz); no
 * `unpublish`/`publish` responde *"a release existe neste tenant?"* (e `null` é
 * o `404`). Por isso o default difere: `create` monta sem `existente`,
 * `unpublish` monta com um objeto.
 */
function montar(
  opts: {
    produto?: unknown;
    existente?: unknown;
    /** `githubPat` cifrado na `lic_settings`. Ausente = tenant sem PAT. */
    pat?: string | null;
    /** O que `getAsset` devolve. `null` = o GitHub respondeu `404`. */
    asset?: GithubAsset | null;
    /** Faz `getAsset` lançar — `401`/`403`/rede. */
    erroGithub?: Error;
    /** Cifra que não abre (chave trocada, valor corrompido). */
    patIlegivel?: boolean;
  } = {},
) {
  const gravado: Record<string, unknown> = {};

  const getAsset = jest.fn(async () => {
    if (opts.erroGithub) throw opts.erroGithub;
    return 'asset' in opts ? opts.asset : ASSET;
  });

  const prisma = {
    licProduct: {
      // Dois caminhos batem aqui: a checagem de tenant (`create`) e a leitura do
      // `sourceRepo` (conferência do asset). Um dobre só, como em produção.
      findFirst: jest.fn(async () =>
        'produto' in opts ? opts.produto : { id: 'prod-1', sourceRepo: 'o/r' },
      ),
    },
    licSettings: {
      findUnique: jest.fn(async () =>
        opts.pat === undefined ? { githubPat: 'cifrado' } : { githubPat: opts.pat },
      ),
    },
    licRelease: {
      findMany: jest.fn(async () => []),
      // O `update` lê `productId`/`assetId`/`sha256` da linha atual para
      // conferir o par que vai VALER. Um dobre que só devolvesse `{ id }`
      // compararia contra `undefined` e faria o teste falhar por defeito do
      // harness, não do código.
      findFirst: jest.fn(async () =>
        opts.existente ? { productId: 'prod-1', assetId: '12345', sha256: SHA, ...opts.existente } : null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(gravado, data);
        return {
          id: 'rel-1',
          notes: null,
          published: true,
          ...data,
        };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'rel-1',
        productId: 'prod-1',
        version: '1.2.0',
        os: 'win-x64',
        releasedAt: new Date(VALIDO.releasedAt),
        assetId: '12345',
        sha256: SHA,
        notes: null,
        published: true,
        ...data,
      })),
    },
  } as unknown as PrismaService;

  const github = { getAsset } as unknown as GithubSourceClient;
  const crypto = {
    decrypt: jest.fn(() => {
      if (opts.patIlegivel) throw new Error('chave trocada');
      return 'pat-em-claro';
    }),
  } as unknown as CryptoService;

  return {
    service: new ReleaseAdminService(prisma, github, crypto),
    prisma,
    gravado,
    getAsset,
  };
}

describe('create — validação antes do banco', () => {
  it('registra uma release válida', async () => {
    const { service, gravado } = montar();

    const r = await service.create('tn-1', VALIDO);

    expect(r).toMatchObject({ version: '1.2.0', os: 'win-x64', published: true });
    expect(gravado).toMatchObject({ tenantId: 'tn-1', assetId: '12345' });
  });

  it('recusa `sha256` malformado, nomeando o formato', async () => {
    const { service } = montar();

    // **O campo que mais importa validar, pelo QUANDO ele falha**: o hash só é
    // conferido na máquina do cliente, depois de baixar. Um valor torto gastaria
    // 80 MB de transferência e apareceria como "download corrompido" — mandando
    // o operador caçar problema de rede num erro de digitação.
    await expect(
      service.create('tn-1', { ...VALIDO, sha256: 'abc' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('normaliza o `sha256` para minúsculas', async () => {
    const { service, gravado } = montar();

    // O CHECK do banco aceita as duas caixas; a comparação da máquina do cliente
    // não necessariamente. Gravar canônico evita um "hash não confere" que só
    // acontece com quem colou de uma fonte em maiúsculas.
    await service.create('tn-1', { ...VALIDO, sha256: SHA.toUpperCase() });

    expect(gravado.sha256).toBe(SHA);
  });

  it('recusa quando falta campo obrigatório', async () => {
    const { service } = montar();

    for (const campo of ['productId', 'version', 'os', 'assetId'] as const) {
      await expect(
        service.create('tn-1', { ...VALIDO, [campo]: '' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('recusa `releasedAt` ausente ou inválido — nunca assume `now()`', async () => {
    const { service } = montar();

    // **Informado, nunca `now()`**: registrar uma release antiga com a data de
    // hoje a tornaria indevidamente autorizada para quem já tem a janela
    // vencida — o oposto exato da promessa da licença perpétua.
    await expect(
      service.create('tn-1', { ...VALIDO, releasedAt: undefined }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create('tn-1', { ...VALIDO, releasedAt: 'ontem' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('recusa produto de outro tenant', async () => {
    const { service } = montar({ produto: null });

    // Sem esta checagem o `create` cairia no FK e responderia `500` — ou, pior,
    // penduraria release no produto alheio se o id fosse conhecido.
    await expect(service.create('tn-1', VALIDO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('recusa versão já registrada, nomeando qual', async () => {
    const { service } = montar({ existente: { id: 'rel-velha' } });

    // O `@@unique` recusaria de todo modo, mas com `P2002` — erro genérico na
    // tela. Nomear é o que permite ao operador entender que já registrou esta.
    await expect(service.create('tn-1', VALIDO)).rejects.toThrow(/1\.2\.0/);
  });
});

describe('unpublish / publish', () => {
  it('despublicar marca `published: false` sem apagar a linha', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    const r = await service.unpublish('tn-1', 'rel-1');

    // **Não apaga**: a trilha de quem já baixou aponta para esta release, e o
    // artefato continua no GitHub. Apagar quebraria a referência do `LicEvent`
    // sem tirar o binário de circulação — o pior dos dois mundos.
    expect(r.published).toBe(false);
    expect(prisma.licRelease.update).toHaveBeenCalledWith({
      where: { id: 'rel-1' },
      data: { published: false },
    });
  });

  it('republicar volta `published: true`', async () => {
    const { service } = montar({ existente: { id: 'rel-1' } });

    // Despublicar por engano é o erro provável de um botão ao lado da lista, e
    // sem volta o operador teria de registrar a mesma versão de novo — que o
    // `@@unique` recusa.
    expect((await service.publish('tn-1', 'rel-1')).published).toBe(true);
  });

  it('release de outro tenant responde 404 nas duas ações', async () => {
    const { service } = montar({ existente: null });

    // O `where` das duas ações casa `id` E `tenantId`. Sem o segundo, quem
    // conhecesse o id despublicaria a release de outro tenant — e o efeito seria
    // a máquina dos clientes dele parando de receber update.
    await expect(service.unpublish('tn-1', 'alheia')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.publish('tn-1', 'alheia')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('list', () => {
  it('filtra por tenant e, quando pedido, por produto', async () => {
    const { service, prisma } = montar();

    await service.list('tn-1', 'prod-1');

    expect(prisma.licRelease.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tn-1', productId: 'prod-1' },
      orderBy: { releasedAt: 'desc' },
    });
  });

  it('sem produto, lista o tenant inteiro', async () => {
    const { service, prisma } = montar();

    await service.list('tn-1');

    expect(prisma.licRelease.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tn-1' },
      orderBy: { releasedAt: 'desc' },
    });
  });
});

/**
 * A conferência do asset contra o GitHub (FIX #242).
 *
 * O defeito que motivou tudo isto **não quebrou nada no cadastro**: a `1.0.1` do
 * War Room foi gravada com `assetId` truncado, o `check` respondeu normalmente e
 * a tela mostrou a versão publicada e correta. O `404` só apareceria no
 * `download` da máquina de um cliente, depois da autorização passar.
 *
 * O que se prova aqui é a linha entre **"o GitHub disse que não existe"** (que
 * recusa) e **"não deu para saber"** (que grava avisando). Confundir os dois nas
 * duas direções tem custo: recusar por rede fora faz o operador corrigir um id
 * certo; aceitar em silêncio devolve o bug original.
 */
describe('create — conferência do asset', () => {
  it('grava e devolve o nome do asset conferido', async () => {
    const { service, getAsset } = montar();

    const view = await service.create('tn-1', VALIDO);

    expect(getAsset).toHaveBeenCalledWith('pat-em-claro', 'o/r', '12345');
    // O nome volta para a tela porque três assets vizinhos na mesma Release
    // (`.exe`, `.zip`, `SHA256SUMS.txt`) têm ids parecidos: ver qual foi
    // registrado é o que denuncia o `.zip` no lugar do instalador. O ProPlan
    // não decide qual é o certo (ADR-014) — mostra o que o operador escolheu.
    expect(view.asset).toEqual({
      checked: true,
      name: 'war-room-setup-1.2.0-win-x64.exe',
      size: 36_314_455,
    });
  });

  it('recusa `assetId` que o GitHub não encontra — o defeito do FIX #242', async () => {
    const { service, prisma } = montar({ asset: null });

    await expect(service.create('tn-1', { ...VALIDO, assetId: 'e234138' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    // **A asserção que importa**: não gravou. Sem ela, o teste passaria mesmo
    // com a release registrada — que é exatamente o estado que causou o bug.
    expect(prisma.licRelease.create).not.toHaveBeenCalled();
  });

  it('a mensagem do `404` nomeia o id e o repo, não fala em permissão', async () => {
    const { service } = montar({ asset: null });

    await expect(service.create('tn-1', { ...VALIDO, assetId: 'e234138' })).rejects.toThrow(
      /e234138.*o\/r/s,
    );
  });

  it('recusa `sha256` que não bate com o do asset', async () => {
    const { service, prisma } = montar({ asset: { ...ASSET, sha256: 'b'.repeat(64) } });

    // Um sha errado passa no cadastro e quebra na conferência de integridade da
    // máquina do cliente — onde parece adulteração de binário, não digitação.
    await expect(service.create('tn-1', VALIDO)).rejects.toThrow(/não bate/);
    expect(prisma.licRelease.create).not.toHaveBeenCalled();
  });

  it('asset sem `digest` no GitHub não acusa divergência', async () => {
    const { service, prisma } = montar({ asset: { ...ASSET, sha256: null } });

    // `null` é "o GitHub não informou" (o campo é recente e falta em asset
    // antigo), não "não bate". Tratá-lo como divergência tornaria impossível
    // registrar release de um asset antigo com o hash correto.
    const view = await service.create('tn-1', VALIDO);

    expect(prisma.licRelease.create).toHaveBeenCalled();
    expect(view.asset).toMatchObject({ checked: true });
  });

  it('sem PAT configurado, grava e avisa que não conferiu (decisão PI)', async () => {
    const { service, prisma, getAsset } = montar({ pat: null });

    const view = await service.create('tn-1', VALIDO);

    // Recusar seria o bloqueio que o FIX #212 removeu: trancaria quem monta o
    // catálogo antes de configurar o source — ordem legítima.
    expect(prisma.licRelease.create).toHaveBeenCalled();
    expect(getAsset).not.toHaveBeenCalled();
    expect(view.asset).toEqual({ checked: false, reason: 'PAT do GitHub não configurado' });
  });

  it('produto sem `sourceRepo` grava e avisa — não há onde conferir', async () => {
    const { service, prisma } = montar({ produto: { id: 'prod-1', sourceRepo: null } });

    const view = await service.create('tn-1', VALIDO);

    expect(prisma.licRelease.create).toHaveBeenCalled();
    expect(view.asset).toMatchObject({ checked: false });
  });

  it('GitHub fora do ar grava e avisa — "não sei" não é "está errado"', async () => {
    const { service, prisma } = montar({
      erroGithub: new GithubSourceError('token inválido ou expirado', 401),
    });

    // `401`/`403`/rede: recusar aqui mandaria o operador corrigir um `assetId`
    // que está certo, e o id certo continuaria sendo recusado.
    const view = await service.create('tn-1', VALIDO);

    expect(prisma.licRelease.create).toHaveBeenCalled();
    expect(view.asset).toEqual({ checked: false, reason: 'token inválido ou expirado' });
  });

  it('PAT ilegível grava e avisa, sem chamar o GitHub', async () => {
    const { service, prisma, getAsset } = montar({ patIlegivel: true });

    const view = await service.create('tn-1', VALIDO);

    // Cifra que não abre (chave trocada) é a mesma classe de "não sei": o
    // `assetId` pode estar perfeito. E não se gasta ida ao GitHub sem token.
    expect(prisma.licRelease.create).toHaveBeenCalled();
    expect(getAsset).not.toHaveBeenCalled();
    expect(view.asset).toMatchObject({
      checked: false,
      reason: expect.stringContaining('ilegível'),
    });
  });

  it('não confere antes de validar formato — hash torto falha sem gastar chamada', async () => {
    const { service, getAsset } = montar();

    await expect(service.create('tn-1', { ...VALIDO, sha256: 'xyz' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    // A ordem importa por custo e por clareza: pedir ao GitHub para depois
    // recusar por formato gasta uma ida à rede e atrasa o erro que já se sabia.
    expect(getAsset).not.toHaveBeenCalled();
  });

  it('não confere quando a versão já está registrada', async () => {
    const { service, getAsset } = montar({ existente: { id: 'rel-9' } });

    await expect(service.create('tn-1', VALIDO)).rejects.toThrow(/já está registrada/);
    expect(getAsset).not.toHaveBeenCalled();
  });
});

/**
 * A correção de uma release já registrada (FIX #242).
 *
 * Sem esta rota, um `assetId` errado **só saía por SQL**: não havia edição, e
 * recadastrar esbarra no `@@unique(productId, version, os)` — `unpublish` muda
 * `published` mas a linha continua ocupando a chave. Foi o que aconteceu com a
 * `1.0.1` do War Room, contra a SPEC-040 §14 (*"o operador resolve o caso de um
 * cliente sem abrir o banco"*).
 */
describe('update — correção do ponteiro', () => {
  it('corrige o `assetId` — o caso que motivou o FIX', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    await service.update('tn-1', 'rel-1', { assetId: '497099385' });

    expect(prisma.licRelease.update).toHaveBeenCalledWith({
      where: { id: 'rel-1' },
      data: { assetId: '497099385' },
    });
  });

  it('campo ausente não é tocado', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    await service.update('tn-1', 'rel-1', { assetId: '999' });

    // **A asserção que separa "editar um campo" de "reescrever a linha".** Se
    // ausente virasse `undefined` gravado, uma correção de `assetId` apagaria a
    // nota e a data — perda silenciosa, no ato de consertar.
    const { data } = (prisma.licRelease.update as jest.Mock).mock.calls[0][0];
    expect(Object.keys(data)).toEqual(['assetId']);
  });

  it('`notes: ""` limpa a nota', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    await service.update('tn-1', 'rel-1', { notes: '' });

    // Vazio aqui **é** limpar: nota em branco é estado legítimo, e exigir SQL
    // para apagar um comentário seria o mesmo defeito em miniatura.
    const { data } = (prisma.licRelease.update as jest.Mock).mock.calls[0][0];
    expect(data.notes).toBeNull();
  });

  it('`assetId: ""` é recusado — vazio não é "limpar"', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    // Release sem ponteiro some do `download` sem sair do `check`: o cliente
    // veria a versão e não conseguiria baixá-la. É o FIX #242 por outro caminho.
    await expect(service.update('tn-1', 'rel-1', { assetId: '' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(prisma.licRelease.update).not.toHaveBeenCalled();
  });

  it('recusa `sha256` malformado', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    await expect(service.update('tn-1', 'rel-1', { sha256: 'abc' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(prisma.licRelease.update).not.toHaveBeenCalled();
  });

  it('recusa corpo vazio em vez de gravar nada', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    // Um `update` sem campos responderia `200` sem ter feito nada — a tela diria
    // "salvo" sobre uma edição que não aconteceu.
    await expect(service.update('tn-1', 'rel-1', {})).rejects.toThrow(/nada para alterar/);
    expect(prisma.licRelease.update).not.toHaveBeenCalled();
  });

  it('recusa release de outro tenant com 404', async () => {
    const { service } = montar({ existente: null });

    await expect(service.update('tn-1', 'rel-alheia', { assetId: '1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('confere o novo `assetId` contra o `sha256` JÁ GRAVADO', async () => {
    const { service, getAsset } = montar({ existente: { id: 'rel-1' } });

    await service.update('tn-1', 'rel-1', { assetId: '497099385' });

    // Editar só o `assetId` tem de conferir contra o hash que já está na linha.
    // Comparar com o que veio no corpo (nada, neste caso) deixaria a troca de um
    // dos dois passar sem comparação — e o par gravado ficaria inconsistente.
    expect(getAsset).toHaveBeenCalledWith('pat-em-claro', 'o/r', '497099385');
  });

  it('recusa `assetId` que o GitHub não encontra, sem gravar', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' }, asset: null });

    await expect(service.update('tn-1', 'rel-1', { assetId: 'e234138' })).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(prisma.licRelease.update).not.toHaveBeenCalled();
  });

  it('sem PAT, corrige assim mesmo e avisa que não conferiu', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' }, pat: null });

    const view = await service.update('tn-1', 'rel-1', { assetId: '497099385' });

    // Mesma decisão do `create`: sem PAT não se sabe, e "não sei" não pode
    // impedir a correção — seria trancar justamente quem está consertando.
    expect(prisma.licRelease.update).toHaveBeenCalled();
    expect(view.asset).toMatchObject({ checked: false });
  });
});
