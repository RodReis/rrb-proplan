import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicCatalogResponse, OfferMappingView } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listOfferMappings: vi.fn(),
  createOfferMapping: vi.fn(),
  deleteOfferMapping: vi.fn(),
  createLicProduct: vi.fn(),
  createLicEdition: vi.fn(),
  updateProductSourceRepo: vi.fn(),
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
    apiMock.updateProductSourceRepo.mockResolvedValue({
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
      expect(apiMock.updateProductSourceRepo).toHaveBeenCalledWith(
        'prod-1',
        'RodReis/war-room',
      ),
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
describe('mapeamentos de oferta', () => {
  it('diz curinga por extenso, não com travessão', async () => {
    apiMock.listOfferMappings.mockResolvedValue([MAPEAMENTO]);
    montar();

    expect(await screen.findByText(/qualquer oferta \(curinga\)/i)).toBeInTheDocument();
  });

  it('cadastra com oferta vazia como null (curinga), nunca string vazia', async () => {
    apiMock.createOfferMapping.mockResolvedValue(MAPEAMENTO);
    montar();

    await userEvent.type(
      await screen.findByLabelText('Id do produto na plataforma'),
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
    montar();

    expect(await screen.findByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });

  it('sem nenhuma oferta ligada, o cartão avisa — venda chegaria e falharia', async () => {
    montar();

    expect(await screen.findByText(/nenhuma oferta ligada/i)).toBeInTheDocument();
  });
});
