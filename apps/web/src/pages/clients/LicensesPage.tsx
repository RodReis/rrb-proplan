import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  createLicEdition,
  createLicProduct,
  deactivateActivation,
  getLicenseDetail,
  getLicensingCatalog,
  issueLicense,
  listLicenseEvents,
  listLicenses,
  revokeLicense,
  type IssuedLicense,
  type LicCatalogResponse,
  type LicEventView,
  type LicenseDetail,
  type LicenseView,
} from '../../lib/api';
import { ClientsShell } from './ClientsShell';
import { SourceOpsPanel } from './SourceOpsPanel';
import { WebhookOpsPanel } from './WebhookOpsPanel';
import {
  eventLabel,
  isAtMachineLimit,
  machineLabel,
  machineStatus,
  machinesLabel,
  searchMode,
  shortDate,
  shortDateTime,
  statusLabel,
  statusTone,
  swapSignal,
  updatesLabel,
} from './licensingView';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

/**
 * Licenças do workspace (SPEC-036) — a **tela mínima** da Fatia 25.
 *
 * Emitir, listar, buscar, revogar e ver a trilha; mais o cadastro mínimo de
 * produto e edição (decisão do PI, 2026-07-29). O painel completo — busca
 * avançada, métricas, desativar máquina — é a SPEC-040.
 *
 * **Página de workspace, não gaveta de projeto:** produto licenciado é do
 * tenant, e um produto pode nem ter repo no catálogo (MVP4 §4).
 *
 * ## A regra que organiza a tela inteira
 *
 * **A chave em claro aparece uma vez e some.** Ela vem só na resposta da
 * emissão; nenhuma leitura a devolve, e recarregar a página a perde para
 * sempre. Por isso ela não vira linha da lista: ocupa um bloco próprio,
 * destacado, com o aviso explícito — e some quando o admin fecha.
 */
export function LicensesPage() {
  const { tenant = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [catalogo, setCatalogo] = useState<LicCatalogResponse | null>(null);
  const [licencas, setLicencas] = useState<LicenseView[]>([]);
  const [ocupado, setOcupado] = useState(false);

  // Emissão
  const [edicaoId, setEdicaoId] = useState('');
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  /** A chave recém-emitida. Existe só aqui, e só até o admin fechar. */
  const [emitida, setEmitida] = useState<IssuedLicense | null>(null);

  // Busca e gaveta (máquinas + trilha)
  const [busca, setBusca] = useState('');
  const [abertaDe, setAbertaDe] = useState<string | null>(null);
  const [trilha, setTrilha] = useState<LicEventView[]>([]);
  const [detalhe, setDetalhe] = useState<LicenseDetail | null>(null);

  // Cadastro de produto/edição (recolhido por padrão: o caminho comum é emitir)
  const [abrirCadastro, setAbrirCadastro] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [cat, lista] = await Promise.all([getLicensingCatalog(), listLicenses()]);
      setCatalogo(cat);
      setLicencas(lista);
      // Pré-seleciona a 1ª edição: com um produto só, escolher é ritual.
      const primeira = cat.products[0]?.editions[0];
      if (primeira) setEdicaoId((atual) => atual || primeira.id);
      setState({ status: 'ready' });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar',
      });
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function emitir() {
    setOcupado(true);
    try {
      const nova = await issueLicense({
        editionId: edicaoId,
        customerEmail: email,
        customerName: nome || undefined,
      });
      setEmitida(nova);
      setEmail('');
      setNome('');
      setLicencas(await listLicenses());
      toast.success('Licença emitida — copie a chave agora');
    } catch (err) {
      // Sem isto, uma recusa do servidor deixaria a tela igual e a pessoa
      // acharia que emitiu.
      toast.error(err instanceof Error ? err.message : 'não foi possível emitir');
    } finally {
      setOcupado(false);
    }
  }

  async function revogar(licenca: LicenseView) {
    const motivo = window.prompt(
      `Revogar a licença de ${licenca.customerEmail}?\n\nMotivo (obrigatório):`,
    );
    // `null` = cancelou. String vazia = confirmou sem motivo, que o servidor
    // recusa — e é ele quem manda, não a tela.
    if (motivo === null) return;

    setOcupado(true);
    try {
      await revokeLicense(licenca.id, motivo);
      setLicencas(await listLicenses());
      toast.success('Licença revogada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível revogar');
    } finally {
      setOcupado(false);
    }
  }

  async function buscar() {
    const filtro = searchMode(busca);
    setOcupado(true);
    try {
      setLicencas(await listLicenses(filtro ?? undefined));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'falha na busca');
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Abre a gaveta: máquinas **e** trilha juntas.
   *
   * As duas numa chamada só porque respondem à mesma pergunta do suporte —
   * *"o que aconteceu com esta licença?"*. Separá-las em dois cliques faria o
   * atendente abrir as duas sempre.
   */
  async function abrirGaveta(id: string) {
    if (abertaDe === id) {
      setAbertaDe(null);
      return;
    }
    try {
      const [d, eventos] = await Promise.all([
        getLicenseDetail(id),
        listLicenseEvents(id),
      ]);
      setDetalhe(d);
      setTrilha(eventos);
      setAbertaDe(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'falha ao abrir a licença');
    }
  }

  /** Suporte manual: libera a vaga quando o self-service do cliente não resolve. */
  async function desativarMaquina(licenseId: string, activationId: string) {
    setOcupado(true);
    try {
      await deactivateActivation(licenseId, activationId);
      // Recarrega as duas: a vaga mudou (detalhe) e a ação virou evento (trilha).
      const [d, eventos] = await Promise.all([
        getLicenseDetail(licenseId),
        listLicenseEvents(licenseId),
      ]);
      setDetalhe(d);
      setTrilha(eventos);
      setLicencas(await listLicenses());
      toast.success('Máquina desativada — a vaga foi liberada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível desativar');
    } finally {
      setOcupado(false);
    }
  }

  const edicoes = (catalogo?.products ?? []).flatMap((p) =>
    p.editions.map((e) => ({ ...e, produto: p })),
  );
  const podeEmitir = Boolean(edicaoId) && email.includes('@') && !ocupado;

  return (
    <ClientsShell
      tenant={tenant}
      title="Licenças"
      subtitle="Emita e revogue as licenças dos produtos deste workspace."
    >
      {state.status === 'loading' && <p className="text-[13px] text-body">Carregando…</p>}

      {state.status === 'error' && (
        <p className="text-[13px] text-danger">{state.message}</p>
      )}

      {state.status === 'ready' && catalogo && (
        <>
          {/* O aviso mais importante da tela: sem chave de assinatura, emitir
              funciona mas a ativação devolve 503 — e quem descobre é o
              comprador, ao abrir o produto. */}
          {!catalogo.signingConfigured && (
            <p
              role="alert"
              className="rounded-[9px] border border-danger bg-panel px-3.5 py-2.5 text-[12.5px] text-text2"
            >
              <strong className="text-danger">Assinatura não configurada.</strong>{' '}
              O servidor está sem <code>LICENSING_SIGNING_KEY</code>: as chaves
              emitidas agora <strong>não vão ativar</strong> em máquina nenhuma.
              Configure antes de vender (ver <code>docs/DEPLOY.md</code> §3.4).
            </p>
          )}

          {/* A chave em claro. Bloco próprio, não linha de lista: ela existe uma
              vez só, e recarregar a página a perde para sempre. */}
          {emitida && (
            <section className="rounded-[14px] border border-accentBorder bg-accentSoft p-5">
              <h2 className="m-0 text-[15px] font-semibold text-text">
                Chave de {emitida.customerEmail}
              </h2>
              <p className="mt-1 text-[12.5px] text-body">
                Copie agora e envie ao comprador.{' '}
                <strong className="text-text2">
                  Ela não será exibida de novo — nem aqui, nem em lugar nenhum.
                </strong>{' '}
                Se perder, será preciso emitir outra.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="select-all rounded-[9px] border border-border2 bg-panel px-3.5 py-2 font-mono text-[15px] tracking-[0.08em] text-text">
                  {emitida.key}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(emitida.key);
                    toast.success('Chave copiada');
                  }}
                  className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-body transition-colors hover:bg-card hover:text-text"
                >
                  Copiar
                </button>
                <button
                  onClick={() => setEmitida(null)}
                  className="rounded-[9px] px-3 py-2 text-[12.5px] text-body2 transition-colors hover:text-text"
                >
                  Já copiei, fechar
                </button>
              </div>
            </section>
          )}

          {/* Emissão */}
          <section className="rounded-[14px] border border-border bg-panel p-5">
            <h2 className="m-0 text-[15px] font-semibold text-text">Emitir licença</h2>

            {edicoes.length === 0 ? (
              // Ausência é informação (ADR-014): sem edição não há o que emitir,
              // e a tela diz o que fazer em vez de mostrar um formulário morto.
              <p className="mt-2 text-[12.5px] text-body">
                Nenhum produto cadastrado ainda. Cadastre um produto e uma edição
                abaixo para começar a emitir.
              </p>
            ) : (
              <fieldset disabled={ocupado} className="mt-3 grid gap-3 border-0 p-0">
                <div className="grid gap-3 min-[720px]:grid-cols-3">
                  <label className="grid gap-1 text-[12px] text-body">
                    Edição
                    <select
                      value={edicaoId}
                      onChange={(e) => setEdicaoId(e.target.value)}
                      className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                    >
                      {edicoes.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.produto.name} — {e.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-[12px] text-body">
                    E-mail do comprador
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="comprador@exemplo.com"
                      className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>

                  <label className="grid gap-1 text-[12px] text-body">
                    Nome (opcional)
                    <input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>
                </div>

                <div>
                  <button
                    onClick={() => void emitir()}
                    disabled={!podeEmitir}
                    className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
                  >
                    Emitir e mostrar a chave
                  </button>
                </div>
              </fieldset>
            )}
          </section>

          {/* Lista + busca */}
          <section className="rounded-[14px] border border-border bg-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-[15px] font-semibold text-text">
                Licenças emitidas
              </h2>
              <div className="flex gap-2">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void buscar()}
                  placeholder="e-mail ou chave"
                  aria-label="Buscar por e-mail ou chave"
                  className="rounded-[9px] border border-border2 bg-bg px-3 py-1.5 text-[12.5px] text-text"
                />
                <button
                  onClick={() => void buscar()}
                  disabled={ocupado}
                  className="rounded-[9px] border border-border2 px-3 py-1.5 text-[12.5px] text-body transition-colors hover:bg-card hover:text-text"
                >
                  Buscar
                </button>
              </div>
            </div>

            {licencas.length === 0 ? (
              <p className="mt-3 text-[12.5px] text-body">
                Nenhuma licença encontrada.
              </p>
            ) : (
              <ul className="mt-3 grid list-none gap-2 p-0">
                {licencas.map((l) => (
                  <li
                    key={l.id}
                    className="rounded-[11px] border border-border2 bg-card px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[13.5px] text-text">
                          {l.customerName ?? l.customerEmail}
                          <span
                            className={
                              'ml-2 rounded-full border px-2 py-px font-mono text-[10px] ' +
                              (statusTone(l.status) === 'ok'
                                ? 'border-accentBorder text-text2'
                                : 'border-danger text-danger')
                            }
                          >
                            {statusLabel(l.status)}
                          </span>
                        </p>
                        <p className="m-0 mt-0.5 text-[11.5px] text-body">
                          {l.productSlug} · {l.editionName} · {machinesLabel(l)}
                          {isAtMachineLimit(l) && l.status === 'ACTIVE' && (
                            <span className="ml-1.5 text-text2">(no limite)</span>
                          )}
                          {' · '}
                          {updatesLabel(l)}
                        </p>
                        {l.revokedReason && (
                          <p className="m-0 mt-0.5 text-[11.5px] text-body2">
                            Revogada em {shortDate(l.revokedAt)}: {l.revokedReason}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => void abrirGaveta(l.id)}
                          className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-body transition-colors hover:bg-panel hover:text-text"
                        >
                          {abertaDe === l.id ? 'Ocultar' : 'Máquinas e trilha'}
                        </button>
                        {l.status === 'ACTIVE' && (
                          <button
                            onClick={() => void revogar(l)}
                            disabled={ocupado}
                            className="rounded-[9px] border border-danger px-2.5 py-1 text-[11.5px] text-danger transition-colors hover:bg-panel"
                          >
                            Revogar
                          </button>
                        )}
                      </div>
                    </div>

                    {abertaDe === l.id && (
                      <div className="mt-2.5 grid gap-3 border-t border-border2 pt-2.5">
                        <div>
                          <p className="m-0 mb-1.5 text-[11.5px] font-semibold text-text2">
                            Máquinas
                            {/* O sinal de troca só aparece quando há o que
                                sinalizar: 2 trocas em 30 dias é vida normal, e
                                um número em toda licença treinaria o olho a
                                ignorá-lo. É sinal, não limite — nada bloqueia. */}
                            {detalhe && swapSignal(detalhe) && (
                              <span className="ml-2 rounded-full border border-danger px-2 py-px font-mono text-[10px] font-normal text-danger">
                                {swapSignal(detalhe)}
                              </span>
                            )}
                          </p>

                          {detalhe?.activations.length === 0 && (
                            <p className="m-0 text-[11.5px] text-body2">
                              Nenhuma máquina ativou esta licença ainda.
                            </p>
                          )}

                          <ul className="grid list-none gap-1 p-0">
                            {detalhe?.activations.map((a) => (
                              <li
                                key={a.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]"
                              >
                                <span
                                  className={
                                    machineStatus(a) === 'desativada'
                                      ? 'text-body2 line-through'
                                      : 'text-body'
                                  }
                                >
                                  {machineLabel(a)}
                                  {a.appVersion && (
                                    <span className="ml-1.5 font-mono text-[10.5px] text-dim">
                                      v{a.appVersion}
                                    </span>
                                  )}
                                  <span className="ml-1.5 text-dim">
                                    {/* `lastSeenAt` NÃO vira "online/offline": o
                                        heartbeat é diário, e chamar de offline
                                        quem bateu há 25 h afirmaria uma queda
                                        que não houve. */}
                                    último sinal {shortDateTime(a.lastSeenAt)}
                                  </span>
                                  {a.deactivatedAt && (
                                    <span className="ml-1.5 text-body2">
                                      · desativada em {shortDate(a.deactivatedAt)}
                                    </span>
                                  )}
                                </span>

                                {!a.deactivatedAt && l.status === 'ACTIVE' && (
                                  <button
                                    onClick={() => void desativarMaquina(l.id, a.id)}
                                    disabled={ocupado}
                                    className="rounded-[9px] border border-border2 px-2 py-0.5 text-[11px] text-body transition-colors hover:bg-panel hover:text-text disabled:opacity-40"
                                  >
                                    Desativar
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <p className="m-0 mb-1.5 text-[11.5px] font-semibold text-text2">
                            Trilha
                          </p>
                          <ul className="grid list-none gap-1 p-0">
                            {trilha.length === 0 && (
                              <li className="text-[11.5px] text-body2">Sem eventos.</li>
                            )}
                            {trilha.map((e) => (
                              <li key={e.id} className="text-[11.5px] text-body">
                                <span className="font-mono text-[10.5px] text-dim">
                                  {shortDateTime(e.createdAt)}
                                </span>{' '}
                                {eventLabel(e.type)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <CadastroProdutos
            catalogo={catalogo}
            aberto={abrirCadastro}
            onToggle={() => setAbrirCadastro((v) => !v)}
            onMudou={() => void carregar()}
          />

          {/* Operação do webhook (SPEC-038, PR-5) — abaixo do cadastro porque a
              ordem da tela é a ordem de uso: emitir é o dia a dia, cadastrar é
              raro, e resolver venda travada é excepcional (mas urgente quando
              acontece — daí o contador de falhas no próprio título). */}
          <WebhookOpsPanel catalogo={catalogo} />

          {/* Acesso ao repo source (SPEC-039, PR-5) — por último porque é a
              operação mais rara das três, e a que mais depende de gente de fora
              (o comprador informar o username, aceitar o convite). O contador no
              título é o que a traz para cima quando há trabalho. */}
          <SourceOpsPanel />
        </>
      )}
    </ClientsShell>
  );
}

/**
 * Cadastro mínimo de produto e edição — recolhido por padrão.
 *
 * O caminho comum desta tela é **emitir**; cadastrar produto acontece uma vez
 * na vida do workspace. Deixá-lo aberto empurraria a emissão para baixo da
 * dobra todo dia por causa de uma tarefa que já foi feita.
 *
 * **Não há botão de remover** — nem aqui, nem na SPEC-040 sem decisão do PI: o
 * `ON DELETE RESTRICT` recusa apagar edição com licença vendida, e oferecer um
 * botão para depois recusá-lo é pior que não oferecer.
 */
function CadastroProdutos({
  catalogo,
  aberto,
  onToggle,
  onMudou,
}: {
  catalogo: LicCatalogResponse;
  aberto: boolean;
  onToggle: () => void;
  onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [pSlug, setPSlug] = useState('');
  const [pNome, setPNome] = useState('');
  const [pPrefixo, setPPrefixo] = useState('');
  const [eProduto, setEProduto] = useState('');
  const [eSlug, setESlug] = useState('');
  const [eNome, setENome] = useState('');

  async function criarProduto() {
    setOcupado(true);
    try {
      await createLicProduct({ slug: pSlug, name: pNome, keyPrefix: pPrefixo });
      setPSlug('');
      setPNome('');
      setPPrefixo('');
      onMudou();
      toast.success('Produto criado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível criar');
    } finally {
      setOcupado(false);
    }
  }

  async function criarEdicao() {
    setOcupado(true);
    try {
      await createLicEdition(eProduto, { slug: eSlug, name: eNome });
      setESlug('');
      setENome('');
      onMudou();
      toast.success('Edição criada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível criar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <button
        onClick={onToggle}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[15px] font-semibold text-text">
          Produtos e edições
        </span>
        <span className="text-[12px] text-body2">{aberto ? 'Ocultar' : 'Mostrar'}</span>
      </button>

      {aberto && (
        <div className="mt-4 grid gap-4">
          <ul className="grid list-none gap-2 p-0">
            {catalogo.products.length === 0 && (
              <li className="text-[12.5px] text-body">Nenhum produto ainda.</li>
            )}
            {catalogo.products.map((p) => (
              <li
                key={p.id}
                className="rounded-[11px] border border-border2 bg-card px-4 py-3"
              >
                <p className="m-0 text-[13.5px] text-text">
                  {p.name}{' '}
                  <span className="font-mono text-[11px] text-dim">
                    {p.slug} · chave {p.keyPrefix}-…
                  </span>
                </p>
                <ul className="mt-1 grid list-none gap-0.5 p-0">
                  {p.editions.map((e) => (
                    <li key={e.id} className="text-[11.5px] text-body">
                      {e.name} · {e.billingModel === 'PERPETUAL' ? 'perpétua' : 'assinatura'}{' '}
                      · {e.maxMachines} máquinas · {e.updatesMonths} meses de updates
                      {/* O número que explica por que não há botão de remover. */}
                      {e.licenseCount > 0 && (
                        <span className="text-body2">
                          {' '}
                          · {e.licenseCount} licença{e.licenseCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <fieldset disabled={ocupado} className="grid gap-2 border-0 p-0">
            <legend className="text-[12px] text-body2">Novo produto</legend>
            <div className="grid gap-2 min-[720px]:grid-cols-4">
              <input
                value={pSlug}
                onChange={(e) => setPSlug(e.target.value)}
                placeholder="identificador (ex.: warroom)"
                aria-label="Identificador do produto"
                className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
              />
              <input
                value={pNome}
                onChange={(e) => setPNome(e.target.value)}
                placeholder="nome (ex.: War Room)"
                aria-label="Nome do produto"
                className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
              />
              <input
                value={pPrefixo}
                onChange={(e) => setPPrefixo(e.target.value.toUpperCase())}
                placeholder="prefixo (ex.: WR)"
                aria-label="Prefixo da chave"
                maxLength={6}
                className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[13px] text-text"
              />
              <button
                onClick={() => void criarProduto()}
                disabled={!pSlug || !pNome || !pPrefixo || ocupado}
                className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-body transition-colors hover:bg-card hover:text-text disabled:opacity-40"
              >
                Criar produto
              </button>
            </div>
          </fieldset>

          {catalogo.products.length > 0 && (
            <fieldset disabled={ocupado} className="grid gap-2 border-0 p-0">
              <legend className="text-[12px] text-body2">Nova edição</legend>
              <div className="grid gap-2 min-[720px]:grid-cols-4">
                <select
                  value={eProduto}
                  onChange={(e) => setEProduto(e.target.value)}
                  aria-label="Produto da edição"
                  className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                >
                  <option value="">Escolha o produto…</option>
                  {catalogo.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  value={eSlug}
                  onChange={(e) => setESlug(e.target.value)}
                  placeholder="identificador (ex.: source)"
                  aria-label="Identificador da edição"
                  className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                />
                <input
                  value={eNome}
                  onChange={(e) => setENome(e.target.value)}
                  placeholder="nome (ex.: Com código-fonte)"
                  aria-label="Nome da edição"
                  className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                />
                <button
                  onClick={() => void criarEdicao()}
                  disabled={!eProduto || !eSlug || !eNome || ocupado}
                  className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-body transition-colors hover:bg-card hover:text-text disabled:opacity-40"
                >
                  Criar edição
                </button>
              </div>
              <p className="text-[11.5px] text-body2">
                Padrões: perpétua, 2 máquinas, 12 meses de updates.
              </p>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
