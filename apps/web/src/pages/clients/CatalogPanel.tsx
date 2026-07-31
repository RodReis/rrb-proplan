import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createLicEdition,
  createLicProduct,
  createOfferMapping,
  deleteOfferMapping,
  listOfferMappings,
  updateLicEditionLimits,
  updateProductSourceRepo,
  type LicCatalogResponse,
  type LicEditionView,
  type LicProductView,
  type OfferMappingView,
} from '../../lib/api';
import { offerLabel } from './webhookOpsView';
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
export function CatalogPanel({
  catalogo,
  onMudou,
}: {
  catalogo: LicCatalogResponse;
  onMudou: () => void;
}) {
  return (
    <div className="grid gap-4">
      <ProdutosBloco catalogo={catalogo} onMudou={onMudou} />
      {/* Oferta e releases só fazem sentido com produto: as duas apontam para
          algo que ainda não existe, e três cartões vazios na primeira visita
          escondem o único que importa. */}
      {catalogo.products.length > 0 && (
        <>
          <OfertasBloco catalogo={catalogo} />
          <ReleasesPanel produtos={catalogo.products} />
        </>
      )}
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
      await updateProductSourceRepo(produto.id, valor.trim());
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
 * que a aba Pendências mostra. Ele mora aqui porque referencia uma **edição**:
 * cadastrar o par ao lado da edição que ele aponta evita a ida e volta entre
 * abas que o desenho anterior exigia.
 */
function OfertasBloco({ catalogo }: { catalogo: LicCatalogResponse }) {
  const [mapeamentos, setMapeamentos] = useState<OfferMappingView[]>([]);
  const [produtoId, setProdutoId] = useState('');
  const [ofertaId, setOfertaId] = useState('');
  const [edicaoId, setEdicaoId] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    try {
      setMapeamentos(await listOfferMappings());
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

  async function criar() {
    setOcupado(true);
    try {
      await createOfferMapping({
        externalProductId: produtoId,
        // Vazio = curinga. `null` explícito, não string vazia: é o que faz
        // "qualquer oferta deste produto" resolver.
        externalOfferId: ofertaId.trim() || null,
        editionId: edicaoId,
      });
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
    <Cartao tom={edicoes.length > 0 && mapeamentos.length === 0 ? 'atencao' : 'neutro'}>
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
          mapeamentos.length > 0 ? (
            <Etiqueta tom="ok" ponto={false}>
              {mapeamentos.length} {mapeamentos.length === 1 ? 'mapeada' : 'mapeadas'}
            </Etiqueta>
          ) : edicoes.length > 0 ? (
            <Etiqueta tom="atencao">nenhuma oferta ligada</Etiqueta>
          ) : undefined
        }
      />

      <ul className="mt-4 grid list-none gap-2 p-0">
        {mapeamentos.length === 0 && (
          <li className="text-[12.5px] text-body">
            Nenhum mapeamento ainda. Pegue o id do produto no painel da plataforma
            e ligue-o à edição correspondente.
          </li>
        )}
        {mapeamentos.map((m) => (
          <LinhaCartao key={m.id}>
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

      <fieldset disabled={ocupado} className="mt-4 grid gap-2 border-0 p-0">
        <legend className="text-[11.5px] text-body2">Novo mapeamento</legend>
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
            onClick={criar}
            disabled={!produtoId.trim() || !edicaoId || ocupado}
            className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
          >
            Cadastrar
          </button>
        </div>
      </fieldset>
    </Cartao>
  );
}
