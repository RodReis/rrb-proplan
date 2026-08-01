import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createLicEdition,
  createLicProduct,
  createOfferMapping,
  deleteOfferMapping,
  listOfferMappings,
  listSeenOffers,
  updateLicEditionLimits,
  updateLicProduct,
  type LicCatalogResponse,
  type LicEditionView,
  type LicProductView,
  type OfferMappingView,
  type SeenOfferView,
} from '../../lib/api';
import { offerLabel } from './webhookOpsView';
import { shortDateTime } from './licensingView';
import { ReleasesPanel } from './ReleasesPanel';
import { Cartao, Etiqueta, LinhaCartao, TituloSecao } from './licensingUi';

/**
 * Produtos e Edições — **o catálogo do que se vende** (decisão do PI,
 * 2026-07-31).
 *
 * ## Por que aba própria
 *
 * O cadastro estava escondido atrás de um "Mostrar" no fim de Configurações, e o
 * de-para de oferta vivia em Pendências, a duas abas de distância da edição que
 * ele referencia. Eram três coisas do mesmo assunto — *o que existe à venda* —
 * espalhadas por duas telas que tratam de outras perguntas.
 *
 * Reunidas, o fluxo fecha num lugar: cadastra o produto, cria a edição, marca se
 * ela dá código-fonte, liga a oferta da plataforma e registra a versão publicada
 * — sem trocar de aba entre passos que dependem uns dos outros.
 *
 * ## Por que o de-para veio junto
 *
 * `Oferta → edição` liga um id da Kiwify a uma **edição**. É cadastro do
 * catálogo, não pendência: ele só aparecia junto das entregas com falha porque é
 * ali que se *descobre* que falta um mapeamento. Descobrir e cadastrar são
 * momentos diferentes — e a aba de falhas continua dizendo qual oferta ficou
 * sem par.
 *
 * **Não há botão de remover produto ou edição** — o `ON DELETE RESTRICT` recusa
 * apagar edição com licença vendida, e oferecer um botão para depois recusá-lo é
 * pior que não oferecer. A contagem de licenças na linha explica o porquê.
 */
type Secao = 'produtos' | 'ofertas' | 'versoes';

const SECOES: Array<{ chave: Secao; rotulo: string }> = [
  { chave: 'produtos', rotulo: 'Produtos' },
  { chave: 'ofertas', rotulo: 'Oferta → edição' },
  { chave: 'versoes', rotulo: 'Versões' },
];

export function CatalogPanel({
  catalogo,
  onMudou,
}: {
  catalogo: LicCatalogResponse;
  onMudou: () => void;
}) {
  const [secao, setSecao] = useState<Secao>('produtos');

  // **Sem produto, não há sub-aba.** As outras duas apontam para algo que ainda
  // não existe, e um trilho de três abas na primeira visita esconde a única que
  // faz alguma coisa. Mesmo argumento do trilho de cinco abas da área.
  if (catalogo.products.length === 0) {
    return (
      <div className="grid gap-4">
        <ProdutosBloco catalogo={catalogo} onMudou={onMudou} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* **Sub-abas, não três blocos empilhados** (2026-07-31): os três assuntos
          são independentes — cadastrar produto, mapear oferta, registrar versão —
          e empilhá-los fazia a aba crescer sem fim, agravado pelas notas de
          release, que são o changelog inteiro da versão.

          Mesmo objeto do trilho da área, um degrau menor: "selecionado" precisa
          significar a mesma coisa nos dois níveis, e um segundo vocabulário de
          navegação na mesma tela é o tipo de estranheza que faz o operador parar
          para entender a interface em vez da tarefa. */}
      <div
        role="tablist"
        className="flex flex-wrap gap-0.5 self-start rounded-[10px] border border-border2 bg-panel p-1"
      >
        {SECOES.map(({ chave, rotulo }) => (
          <button
            key={chave}
            role="tab"
            aria-selected={secao === chave}
            onClick={() => setSecao(chave)}
            className={
              'rounded-[7px] px-3 py-1 text-[12px] transition-colors duration-150 ' +
              (secao === chave
                ? 'bg-card font-semibold text-text'
                : 'text-body2 hover:bg-card/60 hover:text-text')
            }
          >
            {rotulo}
          </button>
        ))}
      </div>

      {secao === 'produtos' && <ProdutosBloco catalogo={catalogo} onMudou={onMudou} />}
      {secao === 'ofertas' && <OfertasBloco catalogo={catalogo} />}
      {secao === 'versoes' && <ReleasesPanel produtos={catalogo.products} />}
    </div>
  );
}

function ProdutosBloco({
  catalogo,
  onMudou,
}: {
  catalogo: LicCatalogResponse;
  onMudou: () => void;
}) {
  // Já aberto quando não há produto nenhum: nesse estado cadastrar **é** a
  // tarefa, e esconder o formulário atrás de um botão cobra um clique para
  // chegar à única coisa que a tela faz.
  const [novo, setNovo] = useState(catalogo.products.length === 0);
  const totalEdicoes = catalogo.products.reduce((s, p) => s + p.editions.length, 0);

  return (
    <Cartao>
      <TituloSecao
        titulo="Produtos"
        descricao="O que existe à venda. Cada produto tem uma ou mais edições, e é a edição que a licença carrega."
        etiqueta={
          <Etiqueta tom="neutro">
            {catalogo.products.length} {catalogo.products.length === 1 ? 'produto' : 'produtos'}
            {totalEdicoes > 0 && ` · ${totalEdicoes} ${totalEdicoes === 1 ? 'edição' : 'edições'}`}
          </Etiqueta>
        }
        acoes={
          <button
            onClick={() => setNovo((v) => !v)}
            aria-expanded={novo}
            className="rounded-[9px] border border-border2 px-3 py-1.5 text-[12px] text-body transition-colors hover:border-hoverb hover:text-text"
          >
            {novo ? 'Cancelar' : 'Novo produto'}
          </button>
        }
      />

      {novo && (
        <NovoProduto
          onCriou={() => {
            setNovo(false);
            onMudou();
          }}
        />
      )}

      <ul className="mt-4 grid list-none gap-3 p-0">
        {catalogo.products.length === 0 && (
          <li className="text-[12.5px] text-body">
            Nenhum produto ainda. Cadastre o primeiro para poder emitir licenças.
          </li>
        )}
        {catalogo.products.map((p) => (
          <ProdutoCard key={p.id} produto={p} onMudou={onMudou} />
        ))}
      </ul>
    </Cartao>
  );
}

function ProdutoCard({
  produto,
  onMudou,
}: {
  produto: LicProductView;
  onMudou: () => void;
}) {
  const [novaEdicao, setNovaEdicao] = useState(false);
  const vendeSource = produto.editions.some((e) => e.grantsSourceAccess);

  return (
    <LinhaCartao className="!px-4 !py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[14px] font-semibold text-text">{produto.name}</p>
          <p className="m-0 mt-0.5 font-mono text-[11px] text-dim">
            {produto.slug} · chave {produto.keyPrefix}-…
          </p>
        </div>
        <button
          onClick={() => setNovaEdicao((v) => !v)}
          aria-expanded={novaEdicao}
          className="shrink-0 rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-body transition-colors hover:border-hoverb hover:text-text"
        >
          {novaEdicao ? 'Cancelar' : 'Nova edição'}
        </button>
      </div>

      <ul className="mt-3 grid list-none gap-1.5 p-0">
        {produto.editions.length === 0 && (
          <li className="text-[11.5px] text-body2">
            Nenhuma edição — sem edição não há o que emitir.
          </li>
        )}
        {produto.editions.map((e) => (
          <EdicaoLinha key={e.id} edicao={e} onMudou={onMudou} />
        ))}
      </ul>

      {novaEdicao && (
        <NovaEdicao
          produtoId={produto.id}
          onCriou={() => {
            setNovaEdicao(false);
            onMudou();
          }}
        />
      )}

      {/* Os links que o e-mail da chave entrega (SPEC-042). Fora do gate
          `vendeSource` de propósito: todo produto vendido precisa dizer onde se
          baixa o que foi comprado, tenha ou não edição com código-fonte. */}
      <UrlsDoEmailCampos produto={produto} onMudou={onMudou} />

      {/* O repositório de código-fonte (SPEC-039, exposto no FIX #212). Só
          aparece quando alguma edição vende source: um produto sem
          `grantsSourceAccess` nunca precisa dele, e um campo a mais em toda
          linha treinaria o olho a pular a seção inteira. */}
      {vendeSource && <SourceRepoCampo produto={produto} onMudou={onMudou} />}
    </LinhaCartao>
  );
}

function EdicaoLinha({
  edicao,
  onMudou,
}: {
  edicao: LicEditionView;
  onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  /**
   * A edição concede código-fonte? (FIX #214.)
   *
   * **O que o `webhook-processor` lê no momento da venda** para agendar o
   * convite. A coluna nasceu no PR-1 da SPEC-039 e não tinha caminho: uma edição
   * criada pela tela nascia com `false` e não havia como mudar sem SQL — a venda
   * chegava, a licença saía sem agendamento, e o comprador da edição mais cara
   * nunca recebia o convite, **sem erro em lugar nenhum**.
   */
  async function alternarSource(valor: boolean) {
    setOcupado(true);
    try {
      await updateLicEditionLimits(edicao.id, { grantsSourceAccess: valor });
      onMudou();
      // Diz o EFEITO, não "salvo": o que muda é o que acontece nas próximas
      // compras — licença já emitida carrega o próprio agendamento.
      toast.success(
        valor
          ? `"${edicao.name}" passa a dar acesso ao repositório nas próximas compras`
          : `"${edicao.name}" deixa de dar acesso ao repositório nas próximas compras`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="rounded-[9px] border border-border2/60 bg-panel px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-text2">{edicao.name}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Etiqueta tom="neutro" ponto={false}>
            {edicao.billingModel === 'PERPETUAL' ? 'perpétua' : 'assinatura'}
          </Etiqueta>
          {edicao.grantsSourceAccess && <Etiqueta tom="info">código-fonte</Etiqueta>}
          {/* O número que explica por que não há botão de remover. */}
          {edicao.licenseCount > 0 && (
            <Etiqueta tom="ok" ponto={false}>
              {edicao.licenseCount} {edicao.licenseCount > 1 ? 'licenças' : 'licença'}
            </Etiqueta>
          )}
        </div>
      </div>

      <p className="m-0 mt-1 text-[11px] text-body2">
        {edicao.maxMachines} máquinas · {edicao.updatesMonths} meses de updates
      </p>

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-[11.5px] text-body transition-colors hover:text-text2">
        <input
          type="checkbox"
          checked={edicao.grantsSourceAccess}
          onChange={(ev) => alternarSource(ev.target.checked)}
          disabled={ocupado}
          className="accent-[var(--info)]"
        />
        dá acesso ao código-fonte
      </label>
    </li>
  );
}

/**
 * Os links que o e-mail da chave entrega junto da compra (SPEC-042).
 *
 * **Aparece para todo produto**, e não só para quem vende código-fonte: a
 * primeira instalação é problema de qualquer comprador. Enquanto o campo está
 * vazio, o e-mail sai só com a chave e quem pagou depende da área de membros da
 * plataforma para descobrir de onde baixa — que é a dependência que esta fatia
 * existe para cortar.
 *
 * **Cada campo salva sozinho.** É o que o `PATCH` do produto permite (ausente
 * não é tocado) e o que evita o botão único que exigiria ler os dois campos para
 * mexer num.
 */
function UrlsDoEmailCampos({
  produto,
  onMudou,
}: {
  produto: LicProductView;
  onMudou: () => void;
}) {
  const semNenhuma = !produto.downloadUrl && !produto.manualUrl;

  return (
    <div className="mt-3 border-t border-border2/60 pt-3">
      <p className="m-0 mb-2 text-[11.5px] text-body2">
        Links que o e-mail da chave entrega.{' '}
        {semNenhuma ? (
          <strong className="text-text2">
            Sem eles, o comprador recebe a chave sem saber onde baixar.
          </strong>
        ) : (
          <>Vazio some do e-mail — nada de link quebrado.</>
        )}
      </p>
      <div className="grid gap-2">
        <UrlCampo
          produtoId={produto.id}
          campo="downloadUrl"
          rotulo={`Link de download de ${produto.name}`}
          botao="Salvar download"
          placeholder="https://github.com/dono/repo/releases/latest"
          atual={produto.downloadUrl}
          onMudou={onMudou}
          mensagem={(v) =>
            v
              ? 'Link de download salvo — o e-mail passa a levar o passo a passo'
              : 'Link de download removido — o e-mail volta a sair só com a chave'
          }
        />
        <UrlCampo
          produtoId={produto.id}
          campo="manualUrl"
          rotulo={`Link do manual de ${produto.name}`}
          botao="Salvar manual"
          placeholder="https://exemplo.com/manual"
          atual={produto.manualUrl}
          onMudou={onMudou}
          mensagem={(v) =>
            v
              ? 'Link do manual salvo'
              : 'Link do manual removido — o e-mail sai sem ele'
          }
        />
      </div>
    </div>
  );
}

function UrlCampo({
  produtoId,
  campo,
  rotulo,
  botao,
  placeholder,
  atual,
  onMudou,
  mensagem,
}: {
  produtoId: string;
  campo: 'downloadUrl' | 'manualUrl';
  rotulo: string;
  botao: string;
  placeholder: string;
  atual: string | null;
  onMudou: () => void;
  mensagem: (valor: string) => string;
}) {
  const [valor, setValor] = useState(atual ?? '');
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true);
    try {
      // Só este campo no corpo: o `PATCH` deixa os outros como estão, e mandar
      // os dois faria salvar um sobrescrever o que o operador acabou de digitar
      // no outro sem ter salvo.
      await updateLicProduct(produtoId, { [campo]: valor.trim() });
      onMudou();
      toast.success(mensagem(valor.trim()));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-2 min-[720px]:grid-cols-[1fr_auto]">
      <input
        type="url"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={placeholder}
        aria-label={rotulo}
        disabled={ocupado}
        className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[12px] text-text transition-colors focus:border-accentBorder"
      />
      <button
        onClick={salvar}
        disabled={ocupado || valor.trim() === (atual ?? '')}
        className="rounded-[9px] border border-border2 px-3 py-2 text-[12px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-40"
      >
        {botao}
      </button>
    </div>
  );
}

/**
 * O repositório de código-fonte do produto (FIX #212).
 *
 * Sem ele preenchido o convite não tem destino, e o operador só descobriria isso
 * no teste de conexão — depois de já ter cadastrado o PAT.
 */
function SourceRepoCampo({
  produto,
  onMudou,
}: {
  produto: LicProductView;
  onMudou: () => void;
}) {
  const [valor, setValor] = useState(produto.sourceRepo ?? '');
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true);
    try {
      await updateLicProduct(produto.id, { sourceRepo: valor.trim() });
      onMudou();
      toast.success(
        valor.trim()
          ? `Repositório de código-fonte: ${valor.trim()}`
          : 'Repositório de código-fonte removido — nenhum convite sairá para este produto',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border2/60 pt-3">
      <p className="m-0 mb-2 text-[11.5px] text-body2">
        Uma edição deste produto vende código-fonte.{' '}
        <strong className="text-text2">
          Sem o repositório abaixo, o convite não tem destino.
        </strong>
      </p>
      <div className="grid gap-2 min-[720px]:grid-cols-[1fr_auto]">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="dono/nome"
          aria-label={`Repositório de código-fonte de ${produto.name}`}
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text transition-colors focus:border-accentBorder"
        />
        <button
          onClick={salvar}
          disabled={ocupado || valor.trim() === (produto.sourceRepo ?? '')}
          className="rounded-[9px] border border-border2 px-3 py-2 text-[12px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-40"
        >
          Salvar repo
        </button>
      </div>
    </div>
  );
}

function NovoProduto({ onCriou }: { onCriou: () => void }) {
  const [slug, setSlug] = useState('');
  const [nome, setNome] = useState('');
  const [prefixo, setPrefixo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    try {
      await createLicProduct({ slug, name: nome, keyPrefix: prefixo });
      toast.success('Produto criado');
      onCriou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível criar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <fieldset
      disabled={ocupado}
      className="mt-4 grid gap-2 rounded-[11px] border border-accentBorder bg-accentSoft p-4"
    >
      <legend className="px-1 text-[11.5px] text-body2">Novo produto</legend>
      <div className="grid gap-2 min-[720px]:grid-cols-4">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="nome (ex.: War Room)"
          aria-label="Nome do produto"
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text transition-colors focus:border-accentBorder"
        />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="identificador (ex.: warroom)"
          aria-label="Identificador do produto"
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12.5px] text-text transition-colors focus:border-accentBorder"
        />
        <input
          value={prefixo}
          onChange={(e) => setPrefixo(e.target.value.toUpperCase())}
          placeholder="prefixo da chave (ex.: WR)"
          aria-label="Prefixo da chave"
          maxLength={6}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12.5px] text-text transition-colors focus:border-accentBorder"
        />
        <button
          onClick={() => void criar()}
          disabled={!slug || !nome || !prefixo || ocupado}
          className="rounded-[9px] bg-btnbg px-3 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Criar produto
        </button>
      </div>
    </fieldset>
  );
}

function NovaEdicao({
  produtoId,
  onCriou,
}: {
  produtoId: string;
  onCriou: () => void;
}) {
  const [slug, setSlug] = useState('');
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setOcupado(true);
    try {
      await createLicEdition(produtoId, { slug, name: nome });
      toast.success('Edição criada');
      onCriou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível criar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <fieldset
      disabled={ocupado}
      className="mt-3 grid gap-2 rounded-[9px] border border-accentBorder bg-accentSoft p-3"
    >
      <legend className="px-1 text-[11px] text-body2">Nova edição</legend>
      <div className="grid gap-2 min-[720px]:grid-cols-3">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="nome (ex.: Com código-fonte)"
          aria-label="Nome da edição"
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[12.5px] text-text transition-colors focus:border-accentBorder"
        />
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="identificador (ex.: source)"
          aria-label="Identificador da edição"
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text transition-colors focus:border-accentBorder"
        />
        <button
          onClick={() => void criar()}
          disabled={!slug || !nome || ocupado}
          className="rounded-[9px] bg-btnbg px-3 py-2 text-[12px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Criar edição
        </button>
      </div>
      <p className="m-0 text-[11px] text-body2">
        Padrões: perpétua, 2 máquinas, 12 meses de updates.
      </p>
    </fieldset>
  );
}

/**
 * `Oferta → edição`: o de-para que resolve a compra.
 *
 * Sem ele a venda chega e falha como "oferta não mapeada" — o estado `FAILED`
 * que a aba Pendências mostra. Mora aqui porque referencia uma **edição**:
 * cadastrar o par ao lado da edição que ele aponta evita a ida e volta entre
 * abas que o desenho anterior exigia.
 *
 * ## O id que o operador não tem (FIX do dogfooding, 2026-07-31)
 *
 * O cadastro pedia o id do produto na plataforma num campo de texto livre. **Ele
 * não existe em lugar nenhum que se copie**: nasce dentro do payload da venda, e
 * o único caminho era ler a mensagem de erro da entrega que falhou e transcrever
 * um uuid à mão.
 *
 * Agora a tela **oferece o que já chegou**: as ofertas vistas nas entregas e
 * ainda sem mapeamento viram linhas com um seletor de edição. Digitar continua
 * possível, recolhido — é o escape de quem quer mapear antes da primeira venda,
 * que é o caso raro.
 */
function OfertasBloco({ catalogo }: { catalogo: LicCatalogResponse }) {
  const [mapeamentos, setMapeamentos] = useState<OfferMappingView[]>([]);
  const [vistas, setVistas] = useState<SeenOfferView[]>([]);
  const [manual, setManual] = useState(false);
  const [produtoId, setProdutoId] = useState('');
  const [ofertaId, setOfertaId] = useState('');
  const [edicaoId, setEdicaoId] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    try {
      const [maps, seen] = await Promise.all([listOfferMappings(), listSeenOffers()]);
      setMapeamentos(maps);
      setVistas(seen);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível carregar');
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const edicoes = catalogo.products.flatMap((p) =>
    p.editions.map((e) => ({ id: e.id, label: `${p.name} · ${e.name}` })),
  );

  async function criar(entrada: {
    externalProductId: string;
    externalOfferId: string | null;
    editionId: string;
  }) {
    setOcupado(true);
    try {
      await createOfferMapping(entrada);
      setProdutoId('');
      setOfertaId('');
      await carregar();
      toast.success('Mapeamento criado — reprocesse a entrega que falhou em Pendências');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível criar');
    } finally {
      setOcupado(false);
    }
  }

  async function remover(id: string) {
    setOcupado(true);
    try {
      await deleteOfferMapping(id);
      await carregar();
      toast.success('Mapeamento removido');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível remover');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao tom={vistas.length > 0 ? 'atencao' : 'neutro'}>
      <TituloSecao
        titulo="Oferta → edição"
        descricao={
          <>
            O de-para que resolve a compra em edição.{' '}
            <strong className="text-body">
              Sem ele, a venda chega e falha como “oferta não mapeada”.
            </strong>
          </>
        }
        etiqueta={
          <>
            {vistas.length > 0 && (
              <Etiqueta tom="atencao">{vistas.length} sem mapeamento</Etiqueta>
            )}
            {mapeamentos.length > 0 && (
              <Etiqueta tom="ok" ponto={false}>
                {mapeamentos.length} {mapeamentos.length === 1 ? 'mapeada' : 'mapeadas'}
              </Etiqueta>
            )}
          </>
        }
      />

      {/* O caminho principal: o que já chegou e ainda não tem par. Vem antes dos
          mapeamentos existentes porque é o que pede ação. */}
      {vistas.length > 0 && (
        <ul className="mt-4 grid list-none gap-2 p-0">
          {vistas.map((v) => (
            <OfertaVistaLinha
              key={`${v.externalProductId} ${v.externalOfferId ?? ''}`}
              oferta={v}
              edicoes={edicoes}
              ocupado={ocupado}
              onMapear={(editionId) =>
                criar({
                  externalProductId: v.externalProductId,
                  externalOfferId: v.externalOfferId,
                  editionId,
                })
              }
            />
          ))}
        </ul>
      )}

      {mapeamentos.length > 0 && (
        <ul className="mt-4 grid list-none gap-2 p-0">
          {mapeamentos.map((m) => (
            <LinhaCartao key={m.id} tom="ok">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 truncate text-[13px] text-text">
                    {m.edition.name}
                    <span className="ml-1.5 font-mono text-[10.5px] text-dim">
                      {m.edition.slug}
                    </span>
                  </p>
                  <p className="m-0 mt-0.5 font-mono text-[10.5px] text-dim">
                    produto {m.externalProductId} · {offerLabel(m)}
                  </p>
                </div>
                <button
                  onClick={() => remover(m.id)}
                  disabled={ocupado}
                  className="shrink-0 rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-body2 transition-colors hover:border-error/45 hover:text-error disabled:opacity-50"
                >
                  Remover
                </button>
              </div>
            </LinhaCartao>
          ))}
        </ul>
      )}

      {vistas.length === 0 && mapeamentos.length === 0 && (
        <p className="mt-4 max-w-[72ch] text-[12.5px] leading-relaxed text-body">
          Nenhuma venda chegou ainda, então não há oferta para mapear.{' '}
          <strong className="text-text2">O id do produto vem dentro da venda</strong> —
          quando a primeira chegar, ela aparece aqui pronta para ligar a uma edição.
        </p>
      )}

      {/* O escape: digitar à mão. Recolhido porque é o caso raro — mapear antes
          da primeira venda, quando ainda não há o que a lista mostrar. */}
      <div className="mt-4 border-t border-border2/60 pt-3">
        <button
          onClick={() => setManual((v) => !v)}
          aria-expanded={manual}
          className="text-[11.5px] text-body2 transition-colors hover:text-text"
        >
          {manual ? 'Ocultar cadastro manual' : 'Cadastrar manualmente'}
        </button>

        {manual && (
          <fieldset disabled={ocupado} className="mt-3 grid gap-2 border-0 p-0">
            <legend className="sr-only">Novo mapeamento manual</legend>
            <p className="m-0 text-[11px] leading-relaxed text-body2">
              Só se você já tem os ids em mãos. Normalmente não é o caso: eles
              chegam com a venda.
            </p>
            <div className="grid gap-2 min-[720px]:grid-cols-4">
              <input
                value={produtoId}
                onChange={(e) => setProdutoId(e.target.value)}
                placeholder="id do produto na plataforma"
                aria-label="Id do produto na plataforma"
                className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text transition-colors focus:border-accentBorder"
              />
              <input
                value={ofertaId}
                onChange={(e) => setOfertaId(e.target.value)}
                placeholder="id da oferta (vazio = qualquer)"
                aria-label="Id da oferta na plataforma"
                className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text transition-colors focus:border-accentBorder"
              />
              <select
                value={edicaoId}
                onChange={(e) => setEdicaoId(e.target.value)}
                aria-label="Edição"
                // `color-scheme` é o que torna a lista aberta legível no tema
                // escuro — sem ela o popup é desenhado pelo sistema em tema claro
                // (achado do dogfooding da SPEC-031, #153).
                className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[12.5px] text-text transition-colors focus:border-accentBorder [color-scheme:dark_light]"
              >
                <option value="">edição…</option>
                {edicoes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  criar({
                    externalProductId: produtoId,
                    // Vazio = curinga. `null` explícito, não string vazia: é o
                    // que faz "qualquer oferta deste produto" resolver.
                    externalOfferId: ofertaId.trim() || null,
                    editionId: edicaoId,
                  })
                }
                disabled={!produtoId.trim() || !edicaoId || ocupado}
                className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
              >
                Cadastrar
              </button>
            </div>
          </fieldset>
        )}
      </div>
    </Cartao>
  );
}

/**
 * Uma oferta que já chegou e ainda não tem par.
 *
 * A linha diz **o que aconteceu** (quantas vendas, quantas falharam, quando) e
 * oferece a única coisa que falta: a edição. O id fica visível em mono, mas
 * ninguém precisa copiá-lo — ele já vai na chamada.
 */
function OfertaVistaLinha({
  oferta,
  edicoes,
  ocupado,
  onMapear,
}: {
  oferta: SeenOfferView;
  edicoes: Array<{ id: string; label: string }>;
  ocupado: boolean;
  onMapear: (editionId: string) => void;
}) {
  const [edicaoId, setEdicaoId] = useState('');

  return (
    <LinhaCartao tom={oferta.falhas > 0 ? 'erro' : 'atencao'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 truncate font-mono text-[12px] text-text">
            {oferta.externalProductId}
          </p>
          <p className="m-0 mt-0.5 text-[11.5px] text-body2">
            {oferta.externalOfferId ? (
              <>
                oferta <span className="font-mono text-dim">{oferta.externalOfferId}</span>
              </>
            ) : (
              // A Kiwify não manda oferta: o mapeamento vira curinga do produto.
              'sem id de oferta — vale para qualquer oferta deste produto'
            )}
            {' · '}
            {oferta.ocorrencias} {oferta.ocorrencias === 1 ? 'venda' : 'vendas'}
            {oferta.falhas > 0 && (
              <span className="text-error">
                {' · '}
                {oferta.falhas} {oferta.falhas === 1 ? 'falhou' : 'falharam'}
              </span>
            )}
            {' · '}última em {shortDateTime(oferta.ultimaEm)}
          </p>
        </div>
        {oferta.falhas > 0 && <Etiqueta tom="erro">venda parada</Etiqueta>}
      </div>

      <div className="mt-3 grid gap-2 min-[720px]:grid-cols-[1fr_auto]">
        <select
          value={edicaoId}
          onChange={(e) => setEdicaoId(e.target.value)}
          aria-label={`Edição para o produto ${oferta.externalProductId}`}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[12.5px] text-text transition-colors focus:border-accentBorder [color-scheme:dark_light]"
        >
          <option value="">escolha a edição que esta venda entrega…</option>
          {edicoes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => onMapear(edicaoId)}
          disabled={!edicaoId || ocupado}
          className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Mapear
        </button>
      </div>
    </LinhaCartao>
  );
}

