import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import { LICENSING_QUEUE, PLATFORM_KIWIFY } from '../licensing.constants';
import { parseKiwifyEvent } from '../domain/kiwify-event';
import { ofertasNaoMapeadas, type OfertaVista } from '../domain/seen-offers';
import type { WebhookJobData } from './webhook-intake.service';

/**
 * Operação do licenciamento (SPEC-038, PR-5) — o mínimo para o dono resolver
 * uma venda que não virou licença **sem** pedir reenvio à plataforma.
 *
 * ## O que este serviço existe para destravar
 *
 * O PR-3 grava evento de oferta não mapeada como `FAILED` **de propósito**: o
 * evento tem dono (o tenant vem da URL), o payload está guardado bruto, e nada
 * foi emitido. Sem uma tela, esse estado é um beco — a informação existe no
 * banco e ninguém a alcança. O critério de aceite da fatia é exatamente sair
 * dele: *"cadastrar o mapeamento e reprocessar o evento pendente emite a
 * licença — sem precisar da plataforma reenviar"*.
 *
 * ## Reprocessar reenfileira; não processa aqui
 *
 * Mesma razão do PR-3: processar na request acopla a resposta ao tempo do
 * processamento. E há uma razão a mais, própria do reprocess — o job é o único
 * caminho que já sabe rodar sob `runInTenantContext` fora de request. Duplicar
 * essa fiação aqui criaria um segundo lugar que precisa acertar o contexto, e o
 * modo de errar é o silencioso (RLS fail-closed grava zero linhas sem erro).
 *
 * ## `webhookSecret` é write-only
 *
 * O `GET` devolve **se está configurado**, nunca o valor. O segredo é o Token
 * que a *Kiwify* gera (achado do PR-3) — a origem dele é o painel dela, então
 * ninguém precisa lê-lo de volta daqui, e uma tela que o exibisse seria uma
 * superfície de vazamento sem nada em troca. Mesmo princípio que manteve o
 * segredo fora da `resolve_past_due_tolerance` no PR-1.
 */

/** Item da lista de entregas de webhook. Sem o payload bruto — ver `webhookEvent()`. */
export interface WebhookEventListItem {
  id: string;
  platform: string;
  eventType: string;
  externalEventId: string;
  status: string;
  error: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  licenseId: string | null;
  /** Carimbo do descarte (SPEC-045). Nulos em entrega nunca descartada. */
  discardedAt: Date | null;
  discardedBy: string | null;
  discardedReason: string | null;
  reopenedAt: Date | null;
}

export interface LicSettingsView {
  /** `true` quando há segredo gravado. O valor **nunca** sai. */
  webhookSecretSet: boolean;
  /** `null` = o ProPlan não corta por atraso (decisão PI #3). */
  pastDueToleranceDays: number | null;
  /**
   * As credenciais da API pública da Kiwify (SPEC-047).
   *
   * **`client_id` e `account_id` saem de volta; o `client_secret` nunca.** Não é
   * inconsistência — é a assimetria da própria dashboard da Kiwify, onde os dois
   * primeiros aparecem em claro e o terceiro mascarado. Esconder o que o
   * operador lê na outra aba do navegador só tiraria dele a chance de conferir o
   * que configurou aqui.
   */
  kiwifyClientId: string | null;
  kiwifyAccountId: string | null;
  kiwifyClientSecretSet: boolean;
  /**
   * Os três presentes. **É o que decide** se o job roda para este tenant e se o
   * botão de busca fica habilitado — derivado aqui para que a tela não repita a
   * regra e as duas versões não divirjam.
   */
  kiwifyApiConfigured: boolean;
}

export interface UpdateSettingsInput {
  /** Ausente = não mexe. String vazia é recusada (ver `updateSettings`). */
  webhookSecret?: unknown;
  /** Ausente = não mexe. `null` explícito = desligar o corte. */
  pastDueToleranceDays?: unknown;
  /**
   * Credenciais da Kiwify (SPEC-047). Ausente = não mexe; string vazia é
   * recusada nos três, como no `webhookSecret` e no `setPat`.
   *
   * **Não há caminho de desligar pela tela, e é deliberado**: metade das
   * credenciais gravadas produziria um job que falha toda madrugada com `401`,
   * cujo sintoma (`fetchError`) é indistinguível de credencial errada. Para
   * desligar, revogue a API key na Kiwify — que é onde a decisão mora.
   */
  kiwifyClientId?: unknown;
  kiwifyClientSecret?: unknown;
  kiwifyAccountId?: unknown;
}

export interface OfferMappingInput {
  externalProductId?: unknown;
  /** `null`/ausente = curinga: qualquer oferta daquele produto. */
  externalOfferId?: unknown;
  editionId?: unknown;
}

/** Teto de itens por página. Lista de operação não pode virar dump da tabela. */
const MAX_PAGE = 100;

@Injectable()
export class LicensingOpsService {
  private readonly logger = new Logger(LicensingOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(LICENSING_QUEUE) private readonly queue: Queue<WebhookJobData>,
    // Cifra o `kiwifyClientSecret` (SPEC-047), como o `githubPat` do
    // `SourceAdminService` e ao contrário do `webhookSecret`. Mesmo serviço,
    // mesma chave: um segundo mecanismo de cifragem seria uma segunda chave a
    // rotacionar.
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Entregas recebidas, mais recentes primeiro, com filtro por status.
   *
   * O `payload` **não** vem na lista: é o corpo bruto da plataforma, com dado do
   * comprador, e a lista é o que a tela carrega sempre. Quem precisa do payload
   * abre o item (`evento()`).
   */
  async listWebhookEvents(status?: string, take = 50): Promise<WebhookEventListItem[]> {
    return this.prisma.licWebhookEvent.findMany({
      where: status ? { status: status as never } : undefined,
      select: {
        id: true,
        platform: true,
        eventType: true,
        externalEventId: true,
        status: true,
        error: true,
        receivedAt: true,
        processedAt: true,
        licenseId: true,
        discardedAt: true,
        discardedBy: true,
        discardedReason: true,
        reopenedAt: true,
      },
      orderBy: { receivedAt: 'desc' },
      take: Math.min(Math.max(1, take), MAX_PAGE),
    });
  }

  /** Uma entrega, com o payload bruto — para o dono ver o que a plataforma mandou. */
  async webhookEvent(id: string) {
    const evento = await this.prisma.licWebhookEvent.findUnique({ where: { id } });
    // Sob RLS, evento de outro tenant já volta `null`: 404 aqui é
    // "não existe para você", que é a resposta certa nos dois casos.
    if (!evento) throw new NotFoundException('Entrega não encontrada');
    return evento;
  }

  /**
   * Reenfileira uma entrega para processamento.
   *
   * **Só o que não deu certo.** Reprocessar um `PROCESSED` não é ideia ruim por
   * ser inútil — é ideia ruim porque a idempotência do PR-3 mora no
   * `UNIQUE (platform, external_event_id)` do **recebimento**, não no
   * processamento: o job rodaria de novo sobre uma venda já emitida. Recusar
   * aqui é mais honesto que confiar que nada vai acontecer.
   */
  async reprocess(id: string, tenantId: string): Promise<{ enqueued: true }> {
    const evento = await this.prisma.licWebhookEvent.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!evento) throw new NotFoundException('Entrega não encontrada');

    if (evento.status === 'PROCESSED') {
      throw new UnprocessableEntityException(
        'Entrega já processada — reprocessar emitiria de novo',
      );
    }

    // **Reprocessar não ressuscita** (SPEC-045). Descartado só volta pelo
    // *Reabrir*, que tem carimbo próprio: descartar e reabrir são dois atos
    // deliberados, simétrico ao Finalizado/Descartado do board. Deixar o
    // reprocess desfazer o descarte em silêncio apagaria o segundo ato.
    if (evento.status === 'DISCARDED') {
      throw new ConflictException(
        'Entrega descartada — use Reabrir para voltar a processá-la',
      );
    }

    // Volta para `PENDING` antes de enfileirar: se o processo cair entre as duas
    // linhas, o estado na tela é "esperando", não "falhou" — e o dono reprocessa
    // de novo. O inverso (enfileirar e depois marcar) deixaria um evento
    // `FAILED` que já está na fila, e o segundo clique duplicaria o job.
    await this.prisma.licWebhookEvent.update({
      where: { id },
      data: {
        status: 'PENDING',
        error: null,
        // **`processedAt: null` junto — FIX #216.** Sem esta linha o `update`
        // viola o CHECK `lic_webhook_events_processed_coherent` e o reprocessar
        // responde `500`: o carimbo do desfecho anterior sobrevive à volta para
        // `PENDING`, e o banco recusa a combinação — *"um PENDING com data diria
        // que foi processado e não foi"* (comentário do CHECK, PR-1 da SPEC-038).
        //
        // A guarda do banco estava certa; o defeito era este `update`, que
        // desfazia o status e o erro e deixava para trás a data. O modo de falhar
        // é o pior possível para esta tela: o botão que existe para tirar a venda
        // do beco é justamente o que não funciona.
        processedAt: null,
      },
    });

    await this.queue.add('webhook', { webhookEventId: id, tenantId });
    this.logger.log(`Entrega ${id} reenfileirada pelo admin`);
    return { enqueued: true };
  }

  /**
   * Tira a entrega da lista de pendências **sem apagar a trilha** (SPEC-045).
   *
   * ## O que este método existe para resolver
   *
   * Uma venda que nunca terá conserto — o caso real foram os disparos do botão
   * *"Testar Webhook"* da Kiwify, cada um com um `product_id` fictício e
   * diferente. Mapear seria pior que deixar: emitiria licença real para venda
   * que não existe. O badge laranja ficava permanente, sem ação possível.
   *
   * ## O que **não** acontece aqui
   *
   * A linha e o payload continuam no banco, consultáveis pelo filtro
   * `Descartadas`. E o `error` original **não é sobrescrito**: ele responde *"por
   * que parou"*, enquanto `discardedReason` responde *"por que desistimos"*. São
   * duas perguntas e uma não pode comer a outra.
   */
  async discard(
    id: string,
    tenantId: string,
    userId: string,
    reason: unknown,
  ): Promise<{ discarded: true }> {
    const motivo = texto(reason);
    // Descarte sem motivo é o mesmo item ilegível que a lista de pendências já
    // produzia, só que escondido. O CHECK do banco também recusa — aqui a
    // recusa é `422` com mensagem, em vez de `500` de constraint.
    if (!motivo) {
      throw new UnprocessableEntityException(
        '`reason` é obrigatório — descarte sem motivo esconde o problema em vez de resolvê-lo',
      );
    }

    const evento = await this.prisma.licWebhookEvent.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!evento) throw new NotFoundException('Entrega não encontrada');

    // **`PROCESSED` não se descarta.** A entrega que virou licença é o elo entre
    // a venda e a chave emitida; escondê-la quebraria a pergunta "de onde veio
    // esta licença". E ela nem aparece em pendências — não há o que resolver.
    if (evento.status === 'PROCESSED') {
      throw new ConflictException(
        'Entrega já virou licença — descartá-la perderia o elo com a venda',
      );
    }

    await this.prisma.licWebhookEvent.update({
      where: { id },
      data: {
        status: 'DISCARDED',
        discardedAt: new Date(),
        discardedBy: userId,
        discardedReason: motivo,
        // **`processedAt` junto — a armadilha do CHECK.**
        // `lic_webhook_events_processed_coherent` afirma
        // `(status = 'PENDING') = (processed_at IS NULL)`. Descartar um evento
        // que estava `PENDING` sem carimbar a data viola o CHECK e devolve
        // `500` na tela — exatamente o defeito do #216, espelhado.
        // `DISCARDED` é desfecho, não espera.
        processedAt: new Date(),
        // Descartar de novo um evento reaberto zera o `reopenedAt`: as colunas
        // guardam o ÚLTIMO ato, e um `reopenedAt` sobrevivente diria que a
        // entrega está aberta quando ela acabou de ser descartada.
        reopenedAt: null,
      },
    });

    this.logger.log(`Entrega ${id} descartada por ${userId} (tenant ${tenantId})`);
    return { discarded: true };
  }

  /**
   * Devolve a entrega descartada para a fila — o caminho de volta (SPEC-045).
   *
   * **Passa pelo job, como o reprocessar.** A rota não decide desfecho: devolve a
   * `PENDING` e enfileira. Quem decide se vira licença ou volta a `FAILED` é o
   * processamento, conforme o mapeamento exista ou não. Processar dentro da
   * request foi recusado na SPEC-038 (*"receber ≠ processar"*) e a razão não
   * mudou.
   */
  async reopen(id: string, tenantId: string): Promise<{ enqueued: true }> {
    const evento = await this.prisma.licWebhookEvent.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!evento) throw new NotFoundException('Entrega não encontrada');

    // Reabrir o que nunca foi descartado não é estado possível — e o CHECK
    // `lic_webhook_events_reopen_after_discard` é a rede de segurança do banco
    // para o mesmo fato.
    if (evento.status !== 'DISCARDED') {
      throw new ConflictException('Entrega não está descartada — não há o que reabrir');
    }

    await this.prisma.licWebhookEvent.update({
      where: { id },
      data: {
        status: 'PENDING',
        // `processedAt: null` pela mesma razão do reprocess (FIX #216): o
        // carimbo do desfecho anterior não pode sobreviver à volta para
        // `PENDING`, ou o CHECK recusa o update.
        processedAt: null,
        // O `error` é limpo aqui, e não no descarte: agora a entrega vai ser
        // processada de novo, e o motivo antigo passaria a descrever uma
        // tentativa que não é mais a atual.
        error: null,
        reopenedAt: new Date(),
        // `discardedAt`/`By`/`Reason` PERMANECEM: são a trilha de que esta
        // entrega já foi descartada uma vez, e o CHECK de reabertura depende do
        // `discardedAt` estar lá.
      },
    });

    await this.queue.add('webhook', { webhookEventId: id, tenantId });
    this.logger.log(`Entrega ${id} reaberta e reenfileirada`);
    return { enqueued: true };
  }

  /** Configuração do tenant. O segredo **não** sai daqui. */
  async settings(tenantId: string): Promise<LicSettingsView> {
    const linha = await this.prisma.licSettings.findUnique({
      where: { tenantId },
      select: {
        webhookSecret: true,
        pastDueToleranceDays: true,
        kiwifyClientId: true,
        kiwifyClientSecret: true,
        kiwifyAccountId: true,
      },
    });

    // Tenant sem linha ainda: `false`/`15` descreve o efeito real — o default do
    // schema é 15, então é o que valerá quando a linha nascer. Inventar `null`
    // aqui diria "não corta" sobre um tenant que vai cortar.
    if (!linha) {
      return {
        webhookSecretSet: false,
        pastDueToleranceDays: 15,
        kiwifyClientId: null,
        kiwifyAccountId: null,
        kiwifyClientSecretSet: false,
        kiwifyApiConfigured: false,
      };
    }

    return {
      // `?? ''` porque a coluna é `String?` desde o FIX #212: a linha pode nascer
      // só com o PAT do source, sem webhook nenhum. Nulo e vazio significam a
      // mesma coisa para esta view — *não configurado* — e é o que o intake já
      // tratava como `401`.
      webhookSecretSet: (linha.webhookSecret ?? '').length > 0,
      pastDueToleranceDays: linha.pastDueToleranceDays,
      // `?? null` porque o contrato da view é `string | null`, e `undefined`
      // desapareceria do JSON — a tela receberia a chave ausente em vez de
      // "não configurado", que são coisas diferentes para quem lê.
      kiwifyClientId: linha.kiwifyClientId ?? null,
      kiwifyAccountId: linha.kiwifyAccountId ?? null,
      kiwifyClientSecretSet: (linha.kiwifyClientSecret ?? '').length > 0,
      kiwifyApiConfigured: kiwifyConfigurado(linha),
    };
  }

  /**
   * Grava segredo e/ou tolerância. Campo ausente não é tocado.
   *
   * **`null` e ausente são coisas diferentes** e é o ponto mais fácil de errar
   * aqui: `pastDueToleranceDays: null` é a mitigação sem deploy do risco aceito
   * (decisão PI #3) — desliga o corte. Ausente é "não mexe". Tratar os dois como
   * iguais tornaria impossível desligar o corte pela tela, que é justamente para
   * que a tela existe.
   */
  async updateSettings(
    tenantId: string,
    input: UpdateSettingsInput,
  ): Promise<LicSettingsView> {
    const dados: {
      webhookSecret?: string;
      pastDueToleranceDays?: number | null;
      kiwifyClientId?: string;
      kiwifyClientSecret?: string;
      kiwifyAccountId?: string;
    } = {};

    if (input.webhookSecret !== undefined) {
      const segredo = typeof input.webhookSecret === 'string' ? input.webhookSecret.trim() : '';
      // Vazio é recusado em vez de gravado: um segredo em branco faria **toda**
      // entrega legítima falhar a assinatura, e o sintoma no log seria só `401`
      // — indistinguível de ataque. Para desligar o webhook, remova a URL no
      // painel da plataforma.
      if (!segredo) {
        throw new UnprocessableEntityException(
          '`webhookSecret` não pode ser vazio — toda entrega passaria a falhar com 401',
        );
      }
      dados.webhookSecret = segredo;
    }

    if (input.pastDueToleranceDays !== undefined) {
      dados.pastDueToleranceDays = tolerancia(input.pastDueToleranceDays);
    }

    // As três da Kiwify (SPEC-047). Vazio recusado nos três pelo mesmo motivo do
    // `webhookSecret`: gravar `''` cria um segundo jeito de dizer "não
    // configurado" que toda leitura teria de checar duas vezes — e o sintoma
    // seria um job falhando em silêncio toda madrugada.
    if (input.kiwifyClientId !== undefined) {
      dados.kiwifyClientId = obrigatorio(input.kiwifyClientId, 'kiwifyClientId');
    }
    if (input.kiwifyAccountId !== undefined) {
      dados.kiwifyAccountId = obrigatorio(input.kiwifyAccountId, 'kiwifyAccountId');
    }
    if (input.kiwifyClientSecret !== undefined) {
      // **Cifrado**, como o `githubPat` (decisão PI, 2026-08-04): um dump do
      // banco não pode virar leitura do catálogo comercial do tenant.
      dados.kiwifyClientSecret = this.crypto.encrypt(
        obrigatorio(input.kiwifyClientSecret, 'kiwifyClientSecret'),
      );
    }

    if (Object.keys(dados).length === 0) {
      throw new UnprocessableEntityException('Nada a atualizar');
    }

    // `upsert`: o tenant pode nunca ter tido linha de settings.
    //
    // **A guarda de "segredo antes da tolerância" caiu no FIX #212.** Ela existia
    // porque o `create` precisava de um `webhookSecret`, e gravar `''` deixaria a
    // linha inválida para o webhook. Agora a coluna é `String?`: a linha nasce sem
    // segredo, e ausente já significa *não configurado* — o mesmo `401` no intake
    // de quando não havia linha nenhuma.
    //
    // O que **não** mudou: string vazia explícita continua recusada acima. Gravar
    // `''` num tenant que já recebe entregas faria todas passarem a falhar, com
    // sintoma indistinguível de ataque.
    await this.prisma.licSettings.upsert({
      where: { tenantId },
      update: dados,
      create: {
        tenantId,
        ...(dados.webhookSecret === undefined
          ? {}
          : { webhookSecret: dados.webhookSecret }),
        // As três da Kiwify seguem a mesma regra do `webhookSecret`: só entram no
        // `create` se vieram. A linha pode nascer só com elas — um tenant que
        // configura a API antes do webhook é caso legítimo (FIX #212).
        ...(dados.kiwifyClientId === undefined
          ? {}
          : { kiwifyClientId: dados.kiwifyClientId }),
        ...(dados.kiwifyClientSecret === undefined
          ? {}
          : { kiwifyClientSecret: dados.kiwifyClientSecret }),
        ...(dados.kiwifyAccountId === undefined
          ? {}
          : { kiwifyAccountId: dados.kiwifyAccountId }),
        pastDueToleranceDays: dados.pastDueToleranceDays ?? 15,
      },
    });

    // O log registra QUE mudou, nunca o valor do segredo.
    this.logger.log(
      `Settings do tenant ${tenantId} atualizados: ${Object.keys(dados).join(', ')}`,
    );
    return this.settings(tenantId);
  }

  /**
   * As ofertas que **já apareceram** nas entregas e ainda não têm mapeamento
   * (FIX do dogfooding, 2026-07-31).
   *
   * ## Por que esta rota existe
   *
   * O cadastro `Oferta → edição` pedia o id do produto na plataforma num campo
   * de texto livre — e **o operador não tem esse id**. Ele nasce dentro do
   * payload da venda e não aparece em tela nenhuma da Kiwify que se copie. O
   * único caminho era ler a mensagem de erro da entrega que falhou e transcrever
   * um uuid à mão.
   *
   * A informação sempre esteve aqui: toda entrega guarda o payload bruto, que é
   * o que torna o reprocessamento possível. Faltava alguém olhar.
   *
   * ## O payload é lido, não indexado
   *
   * `externalProductId` não é coluna — vive dentro do JSON. Ler N eventos e
   * extrair com o parser da plataforma é aceitável **porque a lista é limitada**
   * (`MAX_PAGE`) e esta rota é de configuração, não de caminho quente. Se um dia
   * a operação crescer, a saída é coluna gerada + índice, não paginação maior.
   */
  async listSeenOffers(take = MAX_PAGE): Promise<OfertaVista[]> {
    const [eventos, mapeamentos] = await Promise.all([
      this.prisma.licWebhookEvent.findMany({
        // **Descartadas não contam** (SPEC-045). O agrupamento é derivado: a
        // oferta cujos eventos foram todos descartados some da lista e do badge
        // sem que nada de estado novo nasça na oferta. E se um evento novo do
        // mesmo produto chegar, ela reaparece sozinha — descartar decide sobre
        // entregas, não sobre produtos.
        //
        // O filtro é no `where`, não depois: incluí-las aqui gastaria linhas do
        // `take` com o que a regra descartaria adiante, e uma oferta ativa
        // poderia ficar de fora da página por causa de eventos já resolvidos.
        where: { status: { not: 'DISCARDED' } },
        select: { payload: true, receivedAt: true, status: true, platform: true },
        orderBy: { receivedAt: 'desc' },
        take: Math.min(Math.max(1, take), MAX_PAGE),
      }),
      this.prisma.licOfferMapping.findMany({
        select: { externalProductId: true, externalOfferId: true },
      }),
    ]);

    const paraOferta = eventos.map((ev) => {
      // Só a Kiwify tem parser hoje. Outra plataforma entra aqui quando existir
      // o adapter dela — e até lá o evento vira linha sem produto, que a regra
      // descarta em vez de inventar um id.
      const lido = ev.platform === PLATFORM_KIWIFY ? parseKiwifyEvent(ev.payload) : null;
      return {
        externalProductId: lido?.externalProductId,
        externalOfferId: lido?.externalOfferId ?? null,
        receivedAt: ev.receivedAt,
        status: ev.status as string,
      };
    });

    return ofertasNaoMapeadas(paraOferta, mapeamentos);
  }

  /** Mapeamentos oferta→edição do tenant, com a edição resolvida para a tela. */
  async listOfferMappings(tenantId: string) {
    return this.prisma.licOfferMapping.findMany({
      where: { tenantId },
      include: { edition: { select: { id: true, slug: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cadastra um mapeamento — o ato que destrava a venda parada em `FAILED`.
   *
   * `externalOfferId` nulo é **curinga** do produto. O PR-1 pôs dois uniques por
   * isso (em Postgres NULL não colide com NULL): sem o índice parcial, dois
   * curingas do mesmo produto conviveriam apontando para edições diferentes e a
   * compra emitiria a licença de qualquer uma das duas.
   */
  async createOfferMapping(tenantId: string, input: OfferMappingInput) {
    const externalProductId = texto(input.externalProductId);
    const editionId = texto(input.editionId);
    const externalOfferId = texto(input.externalOfferId) || null;

    if (!externalProductId || !editionId) {
      throw new UnprocessableEntityException(
        '`externalProductId` e `editionId` são obrigatórios',
      );
    }

    // A edição tem de ser deste tenant. Sob RLS um id alheio já volta `null`,
    // mas a mensagem explícita evita o "cadastrei e a compra continua falhando".
    const edicao = await this.prisma.licEdition.findFirst({
      where: { id: editionId },
      select: { id: true },
    });
    if (!edicao) throw new NotFoundException('Edição não encontrada');

    return this.prisma.licOfferMapping.create({
      data: {
        tenantId,
        // A MESMA constante que o processador do PR-3 usa para buscar. Divergir
        // aqui produziria o pior sintoma: mapeamento na tela, compra ainda
        // falhando como "oferta não mapeada", nada errado em log.
        platform: PLATFORM_KIWIFY,
        externalProductId,
        externalOfferId,
        editionId,
      },
    });
  }

  /**
   * Remove um mapeamento.
   *
   * Não mexe em licença já emitida: o mapeamento resolve a compra **no momento**
   * em que ela chega, e apagá-lo depois não desfaz nada. Quem foi emitido
   * continua válido — é revogação que derruba acesso, não isto.
   */
  async deleteOfferMapping(id: string): Promise<{ deleted: true }> {
    const mapeamento = await this.prisma.licOfferMapping.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!mapeamento) throw new NotFoundException('Mapeamento não encontrado');

    await this.prisma.licOfferMapping.delete({ where: { id } });
    return { deleted: true };
  }
}

/**
 * `unknown` → dias de tolerância válidos, ou `null` para desligar.
 *
 * Aceita `null` explícito (desligar) e recusa negativo e não-inteiro. O teto de
 * 3650 dias existe para que um dedo escorregado no formulário não grave uma
 * tolerância de mil anos, que é "nunca cortar" escrito de um jeito que ninguém
 * lê como tal — quem quer isso tem o `null`, que diz o que faz.
 */
function tolerancia(valor: unknown): number | null {
  if (valor === null) return null;

  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 3650) {
    throw new UnprocessableEntityException(
      '`pastDueToleranceDays` deve ser inteiro entre 0 e 3650, ou null para desligar',
    );
  }
  return n;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Campo de credencial que, se vier, não pode vir vazio (SPEC-047).
 *
 * Mesma regra do `webhookSecret` e do `setPat`: string vazia seria um segundo
 * jeito de dizer *não configurado*, e o sintoma de gravá-la é mudo — o job
 * falharia toda madrugada com `401` da Kiwify, indistinguível de credencial
 * revogada.
 */
function obrigatorio(valor: unknown, campo: string): string {
  const bruto = texto(valor);
  if (!bruto) {
    throw new UnprocessableEntityException(`\`${campo}\` não pode ser vazio`);
  }
  return bruto;
}

/**
 * As três credenciais da Kiwify presentes (SPEC-047).
 *
 * **Exportada porque o job do sync precisa da mesma regra.** Duplicá-la lá
 * criaria duas definições de "configurado" que divergem no dia em que a API
 * deles pedir um quarto campo — e a divergência apareceria como job que roda
 * para um tenant cuja tela diz que não está configurado.
 */
export function kiwifyConfigurado(linha: {
  kiwifyClientId: string | null;
  kiwifyClientSecret: string | null;
  kiwifyAccountId: string | null;
}): boolean {
  return Boolean(
    linha.kiwifyClientId && linha.kiwifyClientSecret && linha.kiwifyAccountId,
  );
}
