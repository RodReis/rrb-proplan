import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
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
import { CatalogPanel } from './CatalogPanel';
import { ErrorReportsPanel } from './ErrorReportsPanel';
import { LicenseDangerActions } from './LicenseDangerActions';
import { LicensingSettingsPanel } from './LicensingSettingsPanel';
import { MetricsPanel } from './MetricsPanel';
import { WebhookOpsPanel } from './WebhookOpsPanel';
import { Aviso, Cartao, Etiqueta, LinhaCartao, TituloSecao } from './licensingUi';
import {
  eventLabel,
  isAtMachineLimit,
  machineLabel,
  machineStatus,
  machinesLabel,
  searchTerm,
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

type Aba =
  | 'metricas'
  | 'licencas'
  | 'catalogo'
  | 'pendencias'
  | 'erros'
  | 'configuracoes';

/**
 * As seis seções da área (SPEC-040 §A área, reorganizadas pelo PI em
 * 2026-07-31; **Erros** acrescentada pela SPEC-043).
 *
 * A ordem responde à sequência de perguntas de quem abre a área:
 *
 * 1. **Métricas** — *"como está?"*. Primeira porque é o que se pergunta ao
 *    chegar; emitir é a tarefa de quem já sabe o que fazer.
 * 2. **Licenças** — *"emitir para quem, e o que aconteceu com esta aqui?"*.
 * 3. **Produtos e Edições** — *"o que existe à venda?"*. O catálogo inteiro num
 *    lugar: produto, edição, o de-para da oferta e as versões publicadas.
 * 4. **Pendências** — *"o que falhou?"*. Só o que pede conserto.
 * 5. **Erros** — *"o que está quebrando na máquina de quem comprou?"*.
 * 6. **Configurações** — o que se ajusta uma vez na vida do workspace.
 *
 * O desenho anterior partia assuntos entre abas: código-fonte tinha contagem em
 * Métricas e ação em Pendências; o de-para de oferta ficava a duas abas da
 * edição que referencia; e os três campos de configuração moravam no rodapé de
 * duas telas de operação. Cada assunto agora tem **um** lugar.
 *
 * **Erros fica ao lado de Pendências, não dentro dela.** As duas mostram coisa
 * que deu errado, e a tentação de fundi-las é real — mas respondem a perguntas
 * diferentes e o dono da ação é outro: Pendências é *venda que não virou
 * licença*, resolvida por cadastro no admin; Erros é *app que quebrou na mão do
 * cliente*, resolvido por código noutro repo. Misturá-las faria a falha
 * comercial urgente competir por atenção com o crash de um mês atrás.
 */
const ABAS: Array<{ chave: Aba; rotulo: string }> = [
  { chave: 'metricas', rotulo: 'Métricas' },
  { chave: 'licencas', rotulo: 'Licenças' },
  { chave: 'catalogo', rotulo: 'Produtos e Edições' },
  { chave: 'pendencias', rotulo: 'Pendências' },
  { chave: 'erros', rotulo: 'Erros' },
  { chave: 'configuracoes', rotulo: 'Configurações' },
];

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
  const [aba, setAba] = useState<Aba>('metricas');
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

  // Revogação: id da licença com o painel de confirmação aberto na linha.
  const [revogando, setRevogando] = useState<string | null>(null);

  // Busca e gaveta (máquinas + trilha)
  const [busca, setBusca] = useState('');
  const [abertaDe, setAbertaDe] = useState<string | null>(null);
  const [trilha, setTrilha] = useState<LicEventView[]>([]);
  const [detalhe, setDetalhe] = useState<LicenseDetail | null>(null);

  // Cadastro de produto/edição (recolhido por padrão: o caminho comum é emitir)

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

  async function revogar(licenca: LicenseView, motivo: string) {
    setOcupado(true);
    try {
      await revokeLicense(licenca.id, motivo);
      setRevogando(null);
      setLicencas(await listLicenses());
      toast.success('Licença revogada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível revogar');
    } finally {
      setOcupado(false);
    }
  }

  async function buscar() {
    const termo = searchTerm(busca);
    setOcupado(true);
    try {
      setLicencas(await listLicenses(termo ? { q: termo } : undefined));
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
      await recarregarGaveta(id);
      setAbertaDe(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'falha ao abrir a licença');
    }
  }

  /**
   * Relê detalhe e trilha da licença aberta.
   *
   * Extraído porque **toda ação da gaveta precisa das duas**: desativar máquina
   * muda a vaga (detalhe) e vira evento (trilha); estender muda a data e vira
   * evento; anonimizar muda o e-mail e vira evento. Recarregar só uma deixaria
   * a tela metade velha — e a metade velha é a que o operador leria como
   * "não funcionou".
   */
  async function recarregarGaveta(id: string) {
    const [d, eventos] = await Promise.all([
      getLicenseDetail(id),
      listLicenseEvents(id),
    ]);
    setDetalhe(d);
    setTrilha(eventos);
  }

  /** Suporte manual: libera a vaga quando o self-service do cliente não resolve. */
  async function desativarMaquina(licenseId: string, activationId: string) {
    setOcupado(true);
    try {
      await deactivateActivation(licenseId, activationId);
      // A vaga mudou (detalhe) e a ação virou evento (trilha); a lista mostra a
      // contagem de máquinas, então ela também.
      await recarregarGaveta(licenseId);
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
        <Aviso tom="erro">{state.message}</Aviso>
      )}

      {state.status === 'ready' && catalogo && (
        <>
          {/* O aviso mais importante da tela: sem chave de assinatura, emitir
              funciona mas a ativação devolve 503 — e quem descobre é o
              comprador, ao abrir o produto. */}
          {!catalogo.signingConfigured && (
            // O `border-danger` que estava aqui **não pintava nada**: `danger`
            // nunca existiu no `@theme` do index.css, então o Tailwind não
            // gerava a classe e o alerta mais grave da área saía sem vermelho.
            // O token certo sempre foi `error` — ver `licensingUi.tsx`.
            <Aviso tom="erro">
              <strong className="text-error">Assinatura não configurada.</strong>{' '}
              O servidor está sem <code className="font-mono">LICENSING_SIGNING_KEY</code>:
              as chaves emitidas agora{' '}
              <strong className="text-text">não vão ativar</strong> em máquina
              nenhuma. Configure antes de vender (ver{' '}
              <code className="font-mono">docs/DEPLOY.md</code> §3.4).
            </Aviso>
          )}

          {/* Sem produto nenhum, a área **ensina em vez de mostrar abas
              vazias**.

              A SPEC-040 §A área mandava o item sumir do menu neste caso. Isso
              não se sustentou: o menu é o único caminho para cá, e é *daqui*
              que se cadastra o primeiro produto — esconder deixaria o
              licenciamento inalcançável em todo tenant novo (decisão do PI,
              2026-07-30). O que a regra queria evitar era ruído no menu de quem
              não vende software; esta tela resolve isso dizendo, na última
              linha, para ignorar a área. */}
          {catalogo.products.length === 0 ? (
            <PrimeiroProduto
              catalogo={catalogo}
              onMudou={() => void carregar()}
            />
          ) : (
          <>
          {/* As cinco seções da área. O trilho com fundo próprio dá à aba ativa
              um lugar de onde sair, em vez de um retângulo solto no vazio — e é
              o mesmo objeto dos filtros de período e de status, para que
              "selecionado" signifique a mesma coisa em toda a área. */}
          <div
            role="tablist"
            className="flex flex-wrap gap-0.5 self-start rounded-[11px] border border-border2 bg-panel p-1"
          >
            {ABAS.map(({ chave, rotulo }) => (
              <button
                key={chave}
                role="tab"
                aria-selected={aba === chave}
                onClick={() => setAba(chave)}
                className={
                  'rounded-[8px] px-3.5 py-1.5 text-[12.5px] transition-colors duration-150 ' +
                  (aba === chave
                    ? 'bg-card font-semibold text-text'
                    : 'text-body2 hover:bg-card/60 hover:text-text')
                }
              >
                {rotulo}
              </button>
            ))}
          </div>

          {aba === 'metricas' && <MetricsPanel />}

          {/* A chave em claro. Bloco próprio, não linha de lista: ela existe uma
              vez só, e recarregar a página a perde para sempre.

              **Fora do `aba === 'licencas'` de propósito**: trocar de aba com a
              chave na tela a perderia para sempre, e ela não tem segunda via. */}
          {emitida && (
            // O momento mais irreversível da área ganha o único bloco com fundo
            // de acento cheio: quem acabou de emitir precisa ser interrompido,
            // não informado. `animate-fadeUp` entra uma vez, na aparição —
            // não é loop parado (DESIGN.md §9).
            <section className="anim-popIn rounded-[14px] border border-success/45 bg-success/10 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
                <h2 className="m-0 text-[15px] font-semibold text-text">
                  Chave de {emitida.customerEmail}
                </h2>
              </div>
              <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-body">
                Copie agora e envie ao comprador.{' '}
                <strong className="text-text">
                  Ela não será exibida de novo — nem aqui, nem em lugar nenhum.
                </strong>{' '}
                Se perder, será preciso emitir outra.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="select-all rounded-[9px] border border-border2 bg-bg px-4 py-2.5 font-mono text-[16px] tracking-[0.1em] text-text">
                  {emitida.key}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(emitida.key);
                    toast.success('Chave copiada');
                  }}
                  className="rounded-[9px] bg-btnbg px-4 py-2.5 text-[12.5px] font-semibold text-btnfg transition-opacity hover:opacity-90"
                >
                  Copiar chave
                </button>
                <button
                  onClick={() => setEmitida(null)}
                  className="rounded-[9px] px-3 py-2.5 text-[12.5px] text-body2 transition-colors hover:text-text"
                >
                  Já copiei, fechar
                </button>
              </div>
            </section>
          )}

          {aba === 'licencas' && (
            <>
          {/* Emissão */}
          <Cartao>
            <TituloSecao
              titulo="Emitir licença"
              descricao="A chave aparece uma vez só, logo depois de emitir."
            />

            {edicoes.length === 0 ? (
              // Ausência é informação (ADR-014): sem edição não há o que emitir,
              // e a tela diz o que fazer em vez de mostrar um formulário morto.
              <p className="mt-4 text-[12.5px] text-body">
                Nenhuma edição cadastrada ainda. Crie uma em{' '}
                <strong className="text-text2">Produtos e Edições</strong> para
                começar a emitir.
              </p>
            ) : (
              <fieldset disabled={ocupado} className="mt-4 grid gap-3 border-0 p-0">
                <div className="grid gap-3 min-[720px]:grid-cols-3">
                  <label className="grid gap-1 text-[12px] text-body">
                    Edição
                    <select
                      value={edicaoId}
                      onChange={(e) => setEdicaoId(e.target.value)}
                      // `color-scheme`: sem ela o popup nativo é desenhado pelo
                      // sistema em tema claro sobre o Carbono (achado do
                      // dogfooding da SPEC-031, #153).
                      className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text transition-colors focus:border-accentBorder [color-scheme:dark_light]"
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
                      className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text transition-colors focus:border-accentBorder"
                    />
                  </label>

                  <label className="grid gap-1 text-[12px] text-body">
                    Nome (opcional)
                    <input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text transition-colors focus:border-accentBorder"
                    />
                  </label>
                </div>

                <div>
                  <button
                    onClick={() => void emitir()}
                    disabled={!podeEmitir}
                    className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {ocupado ? 'Emitindo…' : 'Emitir e mostrar a chave'}
                  </button>
                </div>
              </fieldset>
            )}
          </Cartao>

          {/* Lista + busca */}
          <Cartao>
            <TituloSecao
              titulo="Licenças emitidas"
              etiqueta={
                licencas.length > 0 ? (
                  <Etiqueta tom="neutro" ponto={false}>
                    {licencas.length}
                  </Etiqueta>
                ) : undefined
              }
              acoes={
                <>
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void buscar()}
                    placeholder="e-mail ou chave"
                    aria-label="Buscar por e-mail ou chave"
                    className="rounded-[9px] border border-border2 bg-bg px-3 py-1.5 text-[12.5px] text-text transition-colors focus:border-accentBorder"
                  />
                  <button
                    onClick={() => void buscar()}
                    disabled={ocupado}
                    className="rounded-[9px] border border-border2 px-3 py-1.5 text-[12.5px] text-body transition-colors hover:border-hoverb hover:text-text"
                  >
                    Buscar
                  </button>
                </>
              }
            />

            {licencas.length === 0 ? (
              <p className="mt-4 text-[12.5px] text-body">
                {busca.trim()
                  ? 'Nenhuma licença bate com essa busca.'
                  : 'Nenhuma licença emitida ainda. Use o formulário acima para emitir a primeira.'}
              </p>
            ) : (
              <ul className="mt-4 grid list-none gap-2 p-0">
                {licencas.map((l) => (
                  <LinhaCartao
                    key={l.id}
                    tom={statusTone(l.status) === 'ok' ? 'neutro' : 'erro'}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 flex flex-wrap items-center gap-2 truncate text-[13.5px] text-text">
                          {l.customerName ?? l.customerEmail}
                          <Etiqueta tom={statusTone(l.status) === 'ok' ? 'ok' : 'erro'}>
                            {statusLabel(l.status)}
                          </Etiqueta>
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
                            onClick={() =>
                              setRevogando(revogando === l.id ? null : l.id)
                            }
                            aria-expanded={revogando === l.id}
                            className="rounded-[9px] border border-error/45 px-2.5 py-1 text-[11.5px] text-error transition-colors hover:bg-error/10"
                          >
                            {revogando === l.id ? 'Cancelar' : 'Revogar'}
                          </button>
                        )}
                      </div>
                    </div>

                    {revogando === l.id && (
                      <FormRevogar
                        licenca={l}
                        ocupado={ocupado}
                        onConfirmar={(motivo) => void revogar(l, motivo)}
                      />
                    )}

                    {abertaDe === l.id && (
                      <div className="mt-3 grid gap-4 border-t border-border2 pt-3">
                        <div>
                          <p className="m-0 mb-2 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-text2">
                            Máquinas
                            {/* O sinal de troca só aparece quando há o que
                                sinalizar: 2 trocas em 30 dias é vida normal, e
                                um número em toda licença treinaria o olho a
                                ignorá-lo. É sinal, não limite — nada bloqueia. */}
                            {detalhe && swapSignal(detalhe) && (
                              <Etiqueta tom="atencao">{swapSignal(detalhe)}</Etiqueta>
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

                        {/* Estender e excluir a pedido (SPEC-040). Dentro da
                            gaveta, no fim: são as ações que mexem no que já foi
                            decidido, e a lista não é lugar de oferecê-las —
                            exclusão sem volta por clique errado numa linha é
                            exatamente o que a confirmação por digitação evita. */}
                        {detalhe && (
                          <LicenseDangerActions
                            licenca={detalhe}
                            onMudou={() => {
                              void recarregarGaveta(detalhe.id);
                              void carregar();
                            }}
                          />
                        )}
                      </div>
                    )}
                  </LinhaCartao>
                ))}
              </ul>
            )}
          </Cartao>

            </>
          )}

          {/* Produtos e Edições: o catálogo do que se vende. Releases entram
              aqui (SPEC-041 §Escopo item 2 diz "tela no admin" sem nomear a
              seção) porque versão publicada pendura no produto — e o de-para de
              oferta veio de Pendências pelo mesmo motivo: ele aponta para uma
              edição, que é cadastrada nesta tela. */}
          {aba === 'catalogo' && (
            <CatalogPanel catalogo={catalogo} onMudou={() => void carregar()} />
          )}

          {/* Pendências: só o que falhou e pede conserto. O acesso ao
              código-fonte saiu daqui para Métricas (decisão do PI, 2026-07-31),
              onde a contagem e a lista acionável passam a viver juntas. */}
          {aba === 'pendencias' && <WebhookOpsPanel catalogo={catalogo} />}

          {aba === 'erros' && <ErrorReportsPanel catalogo={catalogo} />}

          {/* Configurações: os três ajustes da área, reunidos. Estavam no rodapé
              de duas telas de operação — o argumento de "configuração junto da
              operação" não se sustentou, porque configurar é uma vez na vida e
              operar é diário. */}
          {aba === 'configuracoes' && <LicensingSettingsPanel />}
          </>
          )}
        </>
      )}
    </ClientsShell>
  );
}

/**
 * Confirmação da revogação — **na linha da licença, não num `window.prompt`**.
 *
 * O `prompt` do navegador vinha com o cabeçalho do domínio, tipografia e botões
 * do sistema: um objeto que não é do produto, aparecendo por cima dele. Pior, é
 * o único diálogo do Carbono que ignora o tema — chega em claro sobre a tela
 * escura. É a mesma escolha já feita em `LicenseDangerActions`: ação que exige
 * motivo confirma em formulário próprio, onde o efeito cabe **antes** do campo.
 *
 * O motivo é exigido aqui E no servidor. A tela evita a ida inútil; quem garante
 * é o servidor — revogação sem motivo é a que ninguém explica quando o cliente
 * cobra por que o produto parou.
 */
function FormRevogar({
  licenca,
  ocupado,
  onConfirmar,
}: {
  licenca: LicenseView;
  ocupado: boolean;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const pode = Boolean(motivo.trim()) && !ocupado;

  return (
    <div className="anim-popIn mt-3 grid gap-3 rounded-[9px] border border-error/45 bg-bg p-3.5">
      <p className="m-0 text-[12px] leading-relaxed text-text2">
        <strong className="text-error">
          {licenca.customerEmail} perde o acesso ao produto.
        </strong>{' '}
        A chave deixa de ativar em máquina nova, e as já ativadas param na
        próxima verificação. A trilha e as ativações permanecem — e o motivo
        abaixo fica registrado nela.
      </p>

      <label className="grid gap-1 text-[12px] text-body">
        Motivo (obrigatório)
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pode && onConfirmar(motivo)}
          placeholder="reembolso pedido em 04/08"
          autoFocus
          className="rounded-[9px] border border-border2 bg-panel px-3 py-2 text-[13px] text-text transition-colors focus:border-accentBorder"
        />
      </label>

      <div>
        <button
          onClick={() => onConfirmar(motivo)}
          disabled={!pode}
          className="rounded-[9px] border border-error/45 px-4 py-2 text-[12.5px] font-semibold text-error transition-opacity hover:bg-error/10 disabled:opacity-40"
        >
          {/* "Confirmar revogação" e não "Revogar": o botão que ABRE este painel
              já se chama assim, e dois controles de mesmo rótulo na mesma linha
              é ambiguidade para quem navega por leitor de tela. */}
          {ocupado ? 'Revogando…' : 'Confirmar revogação'}
        </button>
      </div>
    </div>
  );
}

/**
 * A área sem produto nenhum: **explica o que é, e diz quando ignorar**.
 *
 * Substitui as abas vazias — cada uma delas responderia "nada aqui" a uma
 * pergunta que o operador não fez. E substitui o *esconder o item do menu* que a
 * spec pedia, porque esconder tornaria esta tela — a única que cadastra o
 * primeiro produto — inalcançável (decisão do PI, 2026-07-30).
 *
 * **A última linha é a que faz o trabalho da regra original.** Quem não vende
 * software abre isto uma vez, lê "ignore esta área", e não volta. O ruído que o
 * "some" evitava passa a custar uma visita, não um item permanente no menu.
 */
function PrimeiroProduto({
  catalogo,
  onMudou,
}: {
  catalogo: LicCatalogResponse;
  onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Cartao className="!p-6">
      <TituloSecao titulo="Licenciamento de software" />

      <p className="mt-3 max-w-[68ch] text-[12.5px] leading-relaxed text-body">
        Esta área emite e administra chaves de licença dos{' '}
        <strong className="text-text2">seus produtos</strong>: ativação por
        máquina, validade, revogação em caso de reembolso e — quando a edição
        prevê — convite ao repositório de código-fonte. Ela não tem relação com
        os contratos de prestação de serviço:{' '}
        <strong className="text-text2">
          um produto licenciado não é um cliente
        </strong>
        .
      </p>

      {/* Os três passos, porque "cadastre um produto" não diz o que vem
          depois — e o que vem depois é o que faz a venda funcionar. */}
      <ol className="mt-4 grid list-none gap-2 p-0">
        {[
          ['Cadastre o produto', 'nome, identificador e o prefixo que a chave vai carregar'],
          ['Crie ao menos uma edição', 'é ela que a licença carrega — máquinas, updates e se dá código-fonte'],
          ['Ligue a oferta da plataforma', 'o de-para que transforma a venda em licença automaticamente'],
        ].map(([titulo, detalhe], i) => (
          <li key={titulo} className="flex gap-3 text-[12px] leading-relaxed">
            <span
              aria-hidden
              className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accentBorder font-mono text-[10px] text-text2"
            >
              {i + 1}
            </span>
            <span className="text-body">
              <strong className="text-text2">{titulo}</strong> — {detalhe}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[12.5px] text-body">
        Nada acontece aqui até existir um produto cadastrado.
      </p>

      {!aberto && (
        <div className="mt-4">
          <button
            onClick={() => setAberto(true)}
            className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity hover:opacity-90"
          >
            Cadastrar o primeiro produto
          </button>
        </div>
      )}

      {aberto && (
        <div className="mt-5 border-t border-border pt-5">
          {/* Sem como recolher: nesta tela o cadastro **é** a tarefa, e um
              "Ocultar" só devolveria a pessoa ao lugar de onde ela acabou de
              sair. */}
          <CatalogPanel catalogo={catalogo} onMudou={onMudou} />
        </div>
      )}

      <p className="mt-5 border-t border-border pt-4 text-[11.5px] text-body2">
        Se você não vende software licenciado, pode ignorar esta área — ela não
        afeta projetos, clientes nem contratos.
      </p>
    </Cartao>
  );
}
