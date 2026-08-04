import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LicCatalogResponse,
  OfferMappingView,
  SeenOfferView,
} from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listOfferMappings: vi.fn(),
  listSeenOffers: vi.fn(),
  createOfferMapping: vi.fn(),
  deleteOfferMapping: vi.fn(),
  createLicProduct: vi.fn(),
  createLicEdition: vi.fn(),
  updateLicProduct: vi.fn(),
  updateLicEditionLimits: vi.fn(),
  // O `ReleasesPanel` é filho e carrega no mount; sem o mock a chamada cairia
  // no `request` real — sem erro visível, mas fazendo rede em suíte unitária.
  listLicReleases: vi.fn(),
  createLicRelease: vi.fn(),
  unpublishLicRelease: vi.fn(),
  publishLicRelease: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { CatalogPanel } = await import('./CatalogPanel');

const CATALOGO: LicCatalogResponse = {
  signingConfigured: true,
  products: [
    {
      id: 'prod-1',
      slug: 'warroom',
      name: 'War Room',
      keyPrefix: 'WR',
      // `null` é o estado que bloqueava o dogfooding: sem repo, o convite não
      // tem destino (FIX #212).
      sourceRepo: null,
      // `null` nos dois é o estado de todo produto antes da SPEC-042: o e-mail
      // da chave sai sem dizer de onde se baixa o que foi comprado.
      downloadUrl: null,
      manualUrl: null,
      editions: [
        {
          id: 'ed-1',
          slug: 'closed',
          name: 'Sem código-fonte',
          billingModel: 'PERPETUAL',
          maxMachines: 2,
          updatesMonths: 12,
          // `false` é o estado que bloqueava a venda de código-fonte: sem
          // caminho para marcá-lo, a compra nunca agendava convite (FIX #214).
          grantsSourceAccess: false,
          licenseCount: 3,
        },
      ],
    },
  ],
};

const MAPEAMENTO: OfferMappingView = {
  id: 'map-1',
  platform: 'kiwify',
  externalProductId: 'prod-kiwify-1',
  externalOfferId: null,
  editionId: 'ed-1',
  createdAt: '2026-07-29T12:00:00.000Z',
  edition: { id: 'ed-1', slug: 'closed', name: 'Sem código-fonte' },
};

/** Catálogo com uma edição que já vende código-fonte. */
const CATALOGO_COM_SOURCE: LicCatalogResponse = {
  ...CATALOGO,
  products: [
    {
      ...CATALOGO.products[0],
      editions: [{ ...CATALOGO.products[0].editions[0], grantsSourceAccess: true }],
    },
  ],
};

function montar(catalogo = CATALOGO) {
  return render(<CatalogPanel catalogo={catalogo} onMudou={() => {}} />);
}

/**
 * Monta e abre a sub-aba de ofertas.
 *
 * As três seções viraram sub-abas em 2026-07-31 — empilhadas, a aba crescia sem
 * fim, e as notas de release (o changelog inteiro da versão) agravaram isso.
 * Produtos é a sub-aba inicial, então tudo que é de oferta exige o clique.
 */
async function montarEmOfertas(catalogo = CATALOGO) {
  const r = montar(catalogo);
  await userEvent.click(screen.getByRole('tab', { name: /Oferta/i }));
  return r;
}

/**
 * A aba **Produtos e Edições** (reorganização do PI, 2026-07-31).
 *
 * Reúne o que estava partido em duas telas: o cadastro vivia atrás de um
 * "Mostrar" no fim de Configurações, e o de-para `Oferta → edição` ficava em
 * Pendências — a duas abas da edição que ele referencia.
 *
 * O que estes testes protegem não é layout: é **o que a tela oferece**. Um botão
 * de remover que o banco vai recusar, ou um checkbox de código-fonte sem
 * caminho, erram em silêncio — a venda chega e nada acontece.
 */
beforeEach(() => {
  vi.clearAllMocks();
  apiMock.listOfferMappings.mockResolvedValue([]);
  apiMock.listSeenOffers.mockResolvedValue([]);
  apiMock.listLicReleases.mockResolvedValue([]);
});

describe('produtos e edições', () => {
  it('mostra quantas licenças saíram da edição — o que impede apagá-la', async () => {
    montar();

    expect(await screen.findByText(/3 licenças/)).toBeInTheDocument();
  });

  it('não oferece botão de remover produto nem edição', async () => {
    // O `ON DELETE RESTRICT` recusa apagar edição com licença vendida.
    // Oferecer o botão para depois recusá-lo é pior que não oferecer.
    montar();
    await screen.findByText('War Room');

    expect(
      screen.queryByRole('button', { name: /Remover produto|Remover edição|Excluir|Apagar/ }),
    ).toBeNull();
  });

  it('cria produto com slug, nome e prefixo', async () => {
    apiMock.createLicProduct.mockResolvedValue(CATALOGO.products[0]);
    montar();

    await userEvent.click(await screen.findByRole('button', { name: 'Novo produto' }));
    await userEvent.type(screen.getByLabelText('Nome do produto'), 'War Room');
    await userEvent.type(screen.getByLabelText('Identificador do produto'), 'warroom');
    await userEvent.type(screen.getByLabelText('Prefixo da chave'), 'wr');

    await userEvent.click(screen.getByRole('button', { name: 'Criar produto' }));

    await waitFor(() =>
      expect(apiMock.createLicProduct).toHaveBeenCalledWith({
        slug: 'warroom',
        name: 'War Room',
        // O prefixo vira caixa alta na digitação: a chave o carrega em maiúsculas.
        keyPrefix: 'WR',
      }),
    );
  });

  it('cria edição já sabendo de qual produto — sem escolher de novo', async () => {
    // O botão vive DENTRO do produto, então não há select de produto para errar.
    apiMock.createLicEdition.mockResolvedValue(CATALOGO.products[0].editions[0]);
    montar();

    await userEvent.click(await screen.findByRole('button', { name: 'Nova edição' }));
    await userEvent.type(screen.getByLabelText('Nome da edição'), 'Com código-fonte');
    await userEvent.type(screen.getByLabelText('Identificador da edição'), 'source');
    await userEvent.click(screen.getByRole('button', { name: 'Criar edição' }));

    await waitFor(() =>
      expect(apiMock.createLicEdition).toHaveBeenCalledWith('prod-1', {
        slug: 'source',
        name: 'Com código-fonte',
      }),
    );
  });
});

/**
 * O repositório de código-fonte (SPEC-039), exposto no FIX #212.
 *
 * A coluna existia desde o PR-1 daquela fatia e **não tinha caminho pela
 * interface**: sem ela preenchida o convite não tem destino, e o operador só
 * descobriria isso no teste de conexão — depois de já ter cadastrado o PAT.
 */
describe('repositório de código-fonte', () => {
  it('só aparece quando alguma edição vende código-fonte', async () => {
    // Um produto sem `grantsSourceAccess` nunca precisa do campo, e exibi-lo em
    // toda linha treinaria o olho a pular a seção inteira.
    montar();
    await screen.findByText('War Room');

    expect(
      screen.queryByLabelText(/Repositório de código-fonte de War Room/i),
    ).toBeNull();
  });

  it('aparece vazio quando a edição vende source e o repo não foi configurado', async () => {
    montar(CATALOGO_COM_SOURCE);

    const campo = await screen.findByLabelText(/Repositório de código-fonte de War Room/i);
    expect(campo).toHaveValue('');
    // A frase diz o efeito de deixá-lo vazio, não só o nome do campo.
    expect(screen.getByText(/o convite não tem destino/i)).toBeInTheDocument();
  });

  it('salva `owner/name`', async () => {
    apiMock.updateLicProduct.mockResolvedValue({
      ...CATALOGO.products[0],
      sourceRepo: 'RodReis/war-room',
    });
    montar(CATALOGO_COM_SOURCE);

    await userEvent.type(
      await screen.findByLabelText(/Repositório de código-fonte de War Room/i),
      'RodReis/war-room',
    );
    await userEvent.click(screen.getByRole('button', { name: /Salvar repo/i }));

    await waitFor(() =>
      expect(apiMock.updateLicProduct).toHaveBeenCalledWith('prod-1', {
        sourceRepo: 'RodReis/war-room',
      }),
    );
  });

  it('o botão fica inerte enquanto o valor não muda', async () => {
    montar(CATALOGO_COM_SOURCE);

    // Sem isto, clicar sem alterar nada dispararia um PATCH que não muda nada —
    // e o toast de sucesso ensinaria que "salvou" é barato.
    expect(await screen.findByRole('button', { name: /Salvar repo/i })).toBeDisabled();
  });
});

/**
 * Os links que o e-mail da chave entrega (SPEC-042).
 *
 * O que estes testes prendem não é o formulário — é **quem vê o formulário**.
 * Posto atrás do gate `vendeSource` por conveniência (é onde o campo irmão
 * mora), ele sumiria para o produto comum, que é justamente quem mais precisa:
 * quem compra a edição fechada não tem outro canal para descobrir o download.
 */
describe('links do e-mail da chave', () => {
  it('aparece em produto que NÃO vende código-fonte', async () => {
    montar();

    // Ao contrário do `sourceRepo`, estes valem para todo produto: a primeira
    // instalação é problema de qualquer comprador.
    expect(
      await screen.findByLabelText(/Link de download de War Room/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Link do manual de War Room/i)).toBeInTheDocument();
  });

  it('vazio, diz a consequência — não só o nome do campo', async () => {
    montar();

    expect(
      await screen.findByText(/recebe a chave sem saber onde baixar/i),
    ).toBeInTheDocument();
  });

  it('salva o download mandando SÓ esse campo', async () => {
    const URL_DOWNLOAD = 'https://github.com/RodReis/war-room-releases/releases/latest';
    apiMock.updateLicProduct.mockResolvedValue({
      ...CATALOGO.products[0],
      downloadUrl: URL_DOWNLOAD,
    });
    montar();

    await userEvent.type(
      await screen.findByLabelText(/Link de download de War Room/i),
      URL_DOWNLOAD,
    );
    await userEvent.click(screen.getByRole('button', { name: /Salvar download/i }));

    // **Só `downloadUrl` no corpo.** Mandar os dois faria este save gravar o
    // manual como está na tela — incluindo o que o operador digitou e ainda não
    // salvou, ou o vazio de um campo que ele nem tocou.
    await waitFor(() =>
      expect(apiMock.updateLicProduct).toHaveBeenCalledWith('prod-1', {
        downloadUrl: URL_DOWNLOAD,
      }),
    );
  });

  it('salva o manual sem tocar no download', async () => {
    apiMock.updateLicProduct.mockResolvedValue(CATALOGO.products[0]);
    montar();

    await userEvent.type(
      await screen.findByLabelText(/Link do manual de War Room/i),
      'https://exemplo.com/manual',
    );
    await userEvent.click(screen.getByRole('button', { name: /Salvar manual/i }));

    await waitFor(() =>
      expect(apiMock.updateLicProduct).toHaveBeenCalledWith('prod-1', {
        manualUrl: 'https://exemplo.com/manual',
      }),
    );
  });

  it('mostra o valor já configurado, para poder ser corrigido', async () => {
    const URL_DOWNLOAD = 'https://github.com/RodReis/war-room-releases/releases/latest';
    montar({
      ...CATALOGO,
      products: [{ ...CATALOGO.products[0], downloadUrl: URL_DOWNLOAD }],
    });

    // Campo que nasce vazio com valor gravado obrigaria a redigitar a URL
    // inteira para mudar uma letra — e o botão inerte compara contra o atual.
    expect(await screen.findByLabelText(/Link de download de War Room/i)).toHaveValue(
      URL_DOWNLOAD,
    );
    expect(screen.getByRole('button', { name: /Salvar download/i })).toBeDisabled();
  });
});

/**
 * `grantsSourceAccess` na tela (FIX #214).
 *
 * É o que o webhook lê para agendar o convite na compra. Sem caminho para
 * marcá-lo, **não existia forma de vender código-fonte pela interface** — e o
 * modo de errar é mudo: a venda chega, a licença sai sem agendamento, e o
 * comprador da edição mais cara nunca recebe o convite.
 */
describe('acesso ao código-fonte por edição', () => {
  it('mostra o estado atual como checkbox', async () => {
    montar();

    // Checkbox e não botão: a pergunta que a linha responde é "esta edição vende
    // o código?", e um botão obrigaria a inferir o estado atual pelo rótulo da
    // ação.
    expect(
      await screen.findByRole('checkbox', { name: /código-fonte/i }),
    ).not.toBeChecked();
  });

  it('marcar chama o PATCH e diz o efeito nas PRÓXIMAS compras', async () => {
    apiMock.updateLicEditionLimits.mockResolvedValue({
      ...CATALOGO.products[0].editions[0],
      grantsSourceAccess: true,
    });
    montar();

    await userEvent.click(await screen.findByRole('checkbox', { name: /código-fonte/i }));

    await waitFor(() =>
      expect(apiMock.updateLicEditionLimits).toHaveBeenCalledWith('ed-1', {
        grantsSourceAccess: true,
      }),
    );
    // Diz o EFEITO, não "salvo": licença já emitida carrega o próprio agendamento.
    expect(toastMock.success).toHaveBeenCalledWith(
      expect.stringMatching(/próximas compras/i),
    );
  });
});

/**
 * `Oferta → edição` — veio de Pendências (decisão do PI, 2026-07-31).
 *
 * Ele liga um id da plataforma a uma **edição**, que é cadastrada nesta mesma
 * tela. Ficava junto das entregas com falha porque é ali que se *descobre* que
 * falta um mapeamento — mas descobrir e cadastrar são momentos diferentes.
 */
/**
 * `Oferta → edição` — veio de Pendências (decisão do PI, 2026-07-31), e o campo
 * de id mudou de dono no mesmo dia.
 *
 * **O que o dogfooding encontrou**: o cadastro pedia o id do produto na
 * plataforma num campo de texto livre, e **o operador não tem esse id**. Ele
 * nasce dentro do payload da venda; o único caminho era ler a mensagem de erro
 * da entrega que falhou e transcrever um uuid à mão.
 *
 * Agora a tela **oferece o que já chegou**. O que estes testes protegem é isso:
 * a lista tem de aparecer sem digitação, e o cadastro manual tem de continuar
 * existindo — recolhido — para quem mapeia antes da primeira venda.
 */
const OFERTA_VISTA: SeenOfferView = {
  externalProductId: 'prod-kiwify-1',
  externalOfferId: null,
  ocorrencias: 2,
  falhas: 2,
  aguardando: 0,
  situacao: 'PARADA',
  ultimaEm: '2026-07-30T12:35:00.000Z',
};

/**
 * A oferta do caso do dogfooding (#257/#259): `PROCESSED` com licença emitida e
 * sem de-para. A tela pedia ação sobre venda que já tinha sido entregue.
 */
const OFERTA_ENTREGUE: SeenOfferView = {
  externalProductId: 'prod-entregue',
  externalOfferId: null,
  ocorrencias: 3,
  falhas: 0,
  aguardando: 0,
  situacao: 'SEM_DEPARA',
  ultimaEm: '2026-08-04T10:00:00.000Z',
};

describe('ofertas vistas: o caminho sem digitar id', () => {
  it('mostra a oferta que chegou e ainda não tem par', async () => {
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_VISTA]);
    await montarEmOfertas();

    expect(await screen.findByText('prod-kiwify-1')).toBeInTheDocument();
    // O que aconteceu, não só o id: é o que dá contexto para escolher a edição.
    expect(screen.getByText(/2 vendas/)).toBeInTheDocument();
    expect(screen.getByText(/2 falharam/)).toBeInTheDocument();
  });

  it('mapear usa o id da própria linha — sem o operador digitar nada', async () => {
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_VISTA]);
    apiMock.createOfferMapping.mockResolvedValue(MAPEAMENTO);
    await montarEmOfertas();

    await userEvent.selectOptions(
      await screen.findByLabelText(/Edição para o produto prod-kiwify-1/i),
      'ed-1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mapear' }));

    await waitFor(() =>
      expect(apiMock.createOfferMapping).toHaveBeenCalledWith({
        externalProductId: 'prod-kiwify-1',
        // Curinga: a Kiwify não manda oferta, então o par é do produto inteiro.
        externalOfferId: null,
        editionId: 'ed-1',
      }),
    );
  });

  it('sem edição escolhida, o botão não mapeia nada', async () => {
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_VISTA]);
    await montarEmOfertas();

    expect(await screen.findByRole('button', { name: 'Mapear' })).toBeDisabled();
  });

  it('a linha diz quando a plataforma NÃO manda oferta', async () => {
    // Sem esta frase, o `null` pareceria dado faltando em vez de curinga.
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_VISTA]);
    await montarEmOfertas();

    expect(
      await screen.findByText(/vale para qualquer oferta deste produto/i),
    ).toBeInTheDocument();
  });

  it('sem venda nenhuma, explica que o id vem dentro da venda', async () => {
    // O estado que mais confundia: campo pedindo um id que não existe ainda.
    await montarEmOfertas();

    expect(
      await screen.findByText(/O id do produto vem dentro da venda/i),
    ).toBeInTheDocument();
  });
});

/**
 * *Venda parada agora* vs. *sem de-para, nada parado* (SPEC-046).
 *
 * O que estes testes prendem é a **pergunta que a linha responde**. Antes, uma
 * linha só dizia duas coisas ao mesmo tempo — *"esta venda está parada"* e
 * *"este produto não tem de-para"* —, e a fusão produzia o alarme mentiroso
 * que o dogfooding de #257 encontrou: três entregas `PROCESSED` com licença
 * emitida marcavam `3 SEM MAPEAMENTO` em laranja, pedindo uma ação já
 * resolvida.
 */
describe('a lista separa venda parada de de-para faltando', () => {
  it('só entregue: fica no bloco neutro e NÃO conta como venda parada', async () => {
    // O caso do dogfooding, exatamente.
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_ENTREGUE]);
    await montarEmOfertas();

    expect(await screen.findByText('prod-entregue')).toBeInTheDocument();
    expect(screen.getByText(/Sem de-para, nada parado/i)).toBeInTheDocument();
    // A frase que importa: o custo é da PRÓXIMA compra, não desta.
    expect(screen.getByText(/compra destes produtos\s+vai falhar/i)).toBeInTheDocument();
    expect(screen.queryByText(/venda parada/i)).not.toBeInTheDocument();
  });

  it('parada e entregue convivem, cada uma no seu bloco', async () => {
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_VISTA, OFERTA_ENTREGUE]);
    await montarEmOfertas();

    expect(await screen.findByText('prod-kiwify-1')).toBeInTheDocument();
    expect(screen.getByText('prod-entregue')).toBeInTheDocument();
    // Etiquetas separadas: uma conta no alarme, a outra não.
    expect(screen.getByText('1 venda parada')).toBeInTheDocument();
    expect(screen.getByText('1 sem de-para')).toBeInTheDocument();
  });

  it('a linha entregue diz que o de-para vale para as PRÓXIMAS', async () => {
    // A ação sempre esteve certa; errada estava a legenda.
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_ENTREGUE]);
    await montarEmOfertas();

    expect(
      await screen.findByText(/já foi entregue; o de-para vale para as próximas/i),
    ).toBeInTheDocument();
  });

  it('mapear no bloco entregue cria o MESMO de-para e não manda reprocessar', async () => {
    apiMock.listSeenOffers.mockResolvedValue([OFERTA_ENTREGUE]);
    apiMock.createOfferMapping.mockResolvedValue(MAPEAMENTO);
    await montarEmOfertas();

    await userEvent.selectOptions(
      await screen.findByLabelText(/Edição para o produto prod-entregue/i),
      'ed-1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mapear' }));

    await waitFor(() =>
      expect(apiMock.createOfferMapping).toHaveBeenCalledWith({
        externalProductId: 'prod-entregue',
        externalOfferId: null,
        editionId: 'ed-1',
      }),
    );
    // Não há o que reprocessar: mandar fazê-lo seria a legenda mentirosa de novo.
    expect(toastMock.success).toHaveBeenCalledWith(
      expect.stringMatching(/passam a resolver sozinhas/i),
    );
    expect(toastMock.success).not.toHaveBeenCalledWith(
      expect.stringMatching(/reprocesse/i),
    );
  });

  it('entrega aguardando conta como parada — ainda pode falhar', async () => {
    apiMock.listSeenOffers.mockResolvedValue([
      { ...OFERTA_ENTREGUE, aguardando: 1, situacao: 'PARADA' as const },
    ]);
    await montarEmOfertas();

    expect(await screen.findByText(/1 aguardando/)).toBeInTheDocument();
    expect(screen.getByText('1 venda parada')).toBeInTheDocument();
    expect(screen.queryByText(/Sem de-para, nada parado/i)).not.toBeInTheDocument();
  });
});

describe('cadastro manual: o escape, recolhido', () => {
  it('não aparece por padrão — o caminho comum é a lista', async () => {
    await montarEmOfertas();
    await screen.findByRole('button', { name: /Cadastrar manualmente/i });

    expect(screen.queryByLabelText('Id do produto na plataforma')).toBeNull();
  });

  it('abre e cadastra com oferta vazia como null (curinga), nunca string vazia', async () => {
    apiMock.createOfferMapping.mockResolvedValue(MAPEAMENTO);
    await montarEmOfertas();

    await userEvent.click(
      await screen.findByRole('button', { name: /Cadastrar manualmente/i }),
    );
    await userEvent.type(
      screen.getByLabelText('Id do produto na plataforma'),
      'prod-kiwify-1',
    );
    await userEvent.selectOptions(screen.getByLabelText('Edição'), 'ed-1');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() =>
      expect(apiMock.createOfferMapping).toHaveBeenCalledWith({
        externalProductId: 'prod-kiwify-1',
        externalOfferId: null,
        editionId: 'ed-1',
      }),
    );
  });

  it('o botão de cadastrar fica travado sem produto e sem edição', async () => {
    await montarEmOfertas();

    await userEvent.click(
      await screen.findByRole('button', { name: /Cadastrar manualmente/i }),
    );
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });

  it('diz que normalmente não é o caso — os ids chegam com a venda', async () => {
    await montarEmOfertas();

    await userEvent.click(
      await screen.findByRole('button', { name: /Cadastrar manualmente/i }),
    );
    expect(screen.getByText(/eles\s+chegam com a venda/i)).toBeInTheDocument();
  });
});

describe('mapeamentos já cadastrados', () => {
  it('diz curinga por extenso, não com travessão', async () => {
    apiMock.listOfferMappings.mockResolvedValue([MAPEAMENTO]);
    await montarEmOfertas();

    expect(await screen.findByText(/qualquer oferta \(curinga\)/i)).toBeInTheDocument();
  });
});
