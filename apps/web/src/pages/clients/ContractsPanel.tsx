import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  acceptContract,
  contractPublicUrl,
  createContractLink,
  getContract,
  getContractLink,
  getProviderProfile,
  issueContract,
  listContractTemplates,
  listContracts,
  revokeContractLink,
  type AcceptanceChannel,
  type ContractDetail,
  type ContractLinkInfo,
  type ContractModality,
  type ContractSummary,
  type ProviderProfileView,
  type TemplateSummary,
} from '../../lib/api';
import {
  canRevoke,
  generateLabel,
  LINK_STATE_LABEL,
  needsRegenerateConfirm,
} from './clientDetailView';
import {
  ACCEPTANCE_CHANNELS,
  brl,
  contractLabel,
  contractLinkState,
  horas,
  isAccepted,
  issueBlockedReason,
  modalityLabel,
  shortDateTime,
} from './contractsView';

interface Props {
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  /** Chamado quando o aceite move o card, para o funil recarregar. */
  onCardMoved?: () => void;
}

interface Dados {
  contratos: ContractSummary[];
  templates: TemplateSummary[];
  perfil: ProviderProfileView;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dados: Dados };

/**
 * Contratos do projeto (SPEC-034 §2.13): emitir, link público e aceite.
 *
 * **Três atos com consequências muito diferentes, e a tela precisa dizer qual é
 * qual** — o §2.6 é explícito:
 *
 * - **Emitir** cria uma versão nova e **não move o card**.
 * - **Gerar link** expõe CPF/CNPJ e endereço das duas partes numa URL sem
 *   autenticação, por 48 h.
 * - **Registrar aceite** é o único ato que move `CONTRACT_PENDING →
 *   CONTRACT_APPROVED`.
 *
 * **O aceite é registro do prestador, não assinatura do cliente** (§3). A tela
 * não pode sugerir o contrário em lugar nenhum: quem clica é quem já recebeu o
 * "sim" por fora, e o que se grava é esse fato — com canal e data.
 */
export function ContractsPanel({ projectId, projectTitle, onClose, onCardMoved }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [detalhe, setDetalhe] = useState<ContractDetail | null>(null);
  const [link, setLink] = useState<ContractLinkInfo | null>(null);
  /** Token em claro — só existe nesta aba, e só até recarregar. */
  const [token, setToken] = useState<string | null>(null);
  const [confirmarRegenerar, setConfirmarRegenerar] = useState(false);

  const [modalidade, setModalidade] = useState<ContractModality>('desenvolvimento');
  const [condicoes, setCondicoes] = useState('');
  const [canal, setCanal] = useState<AcceptanceChannel>('email');
  const [observacao, setObservacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const abrirContrato = useCallback(async (id: string) => {
    setDetalhe(await getContract(id));
    setToken(null);
    try {
      setLink(await getContractLink(id));
    } catch {
      setLink({ active: false });
    }
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [contratos, templates, perfil] = await Promise.all([
        listContracts(projectId),
        listContractTemplates(),
        getProviderProfile(),
      ]);
      setState({ status: 'ready', dados: { contratos, templates, perfil } });
      // Abre a versão mais recente: quem entra no painel quer ver o contrato,
      // não escolher qual contrato ver.
      if (contratos.length > 0) await abrirContrato(contratos[0].id);
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar',
      });
    }
  }, [projectId, abrirContrato]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function executar(acao: () => Promise<void>) {
    setOcupado(true);
    setErroAcao(null);
    try {
      await acao();
    } catch (err) {
      // Sem isto, uma recusa do servidor (sem estimativa aprovada, sem escopo,
      // template ainda semeado) deixaria a tela igual e a pessoa acharia que
      // funcionou.
      setErroAcao(err instanceof Error ? err.message : 'a ação falhou');
    } finally {
      setOcupado(false);
    }
  }

  if (state.status === 'loading') {
    return <Gaveta onClose={onClose} titulo={projectTitle}>
      <p className="text-[13px] text-body">Carregando…</p>
    </Gaveta>;
  }

  if (state.status === 'error') {
    return <Gaveta onClose={onClose} titulo={projectTitle}>
      <p className="text-[13px] text-danger">{state.message}</p>
    </Gaveta>;
  }

  const { contratos, templates, perfil } = state.dados;
  const bloqueio = issueBlockedReason(
    perfil,
    templates.find((t) => t.modality === modalidade),
  );
  const estadoLink = contractLinkState(link);
  /**
   * A URL só aparece com o token em claro, que o servidor devolve **uma única
   * vez**. Recarregada a aba, ele não é recuperável — nem pelo painel — e a
   * saída é regenerar. Oferecer cópia sem token seria oferecer uma URL que não
   * existe.
   */
  const urlPublica = token ? contractPublicUrl(token) : null;

  return (
    <Gaveta onClose={onClose} titulo={projectTitle}>
      <div className="grid gap-4">
        {/* ---------------------------------------------------------------- */}
        {/* Emitir */}
        {/* ---------------------------------------------------------------- */}
        <section className="rounded-[12px] border border-border bg-panel p-4">
          <h3 className="m-0 text-[13.5px] font-semibold text-text">
            Emitir contrato
          </h3>
          <p className="mt-1 text-[12px] text-body">
            Congela escopo, valor e horas num documento que não muda depois.
            Emitir <strong>não move o card</strong> — quem move é o aceite.
          </p>

          <div className="mt-3 grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[11.5px] text-body">Modalidade</span>
              <select
                value={modalidade}
                onChange={(e) => setModalidade(e.target.value as ContractModality)}
                className="rounded-[8px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
              >
                {templates.map((t) => (
                  <option key={t.modality} value={t.modality}>
                    {modalityLabel(t.modality)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-[11.5px] text-body">
                Condições de pagamento
              </span>
              <textarea
                value={condicoes}
                rows={3}
                onChange={(e) => setCondicoes(e.target.value)}
                placeholder="Ex.: 50% na assinatura, 50% na entrega."
                className="rounded-[8px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
              />
            </label>
          </div>

          {bloqueio && (
            <p className="mt-3 rounded-[9px] border border-accent-border bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-text2">
              {bloqueio}
            </p>
          )}

          <button
            type="button"
            disabled={ocupado || bloqueio !== null}
            onClick={() =>
              void executar(async () => {
                const novo = await issueContract(projectId, {
                  modality: modalidade,
                  paymentTerms: condicoes.trim() || undefined,
                });
                toast.success(`Contrato v${novo.version} emitido`);
                await carregar();
                await abrirContrato(novo.id);
              })
            }
            className="mt-3 rounded-[8px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110 disabled:opacity-50"
          >
            {contratos.length > 0 ? 'Emitir nova versão' : 'Emitir contrato'}
          </button>
        </section>

        {erroAcao && (
          <p className="rounded-[9px] border border-danger px-3.5 py-2.5 text-[12.5px] text-danger">
            {erroAcao}
          </p>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Versões emitidas */}
        {/* ---------------------------------------------------------------- */}
        {contratos.length > 0 && (
          <section className="grid gap-2">
            <h3 className="m-0 text-[13.5px] font-semibold text-text">
              Versões emitidas
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {contratos.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void executar(() => abrirContrato(c.id))}
                  className={
                    'rounded-[9px] border px-3 py-1.5 text-[12px] transition-colors duration-150 ' +
                    (detalhe?.id === c.id
                      ? 'border-accent-border bg-accent-soft font-semibold text-text'
                      : 'border-border2 text-body2 hover:bg-card hover:text-text')
                  }
                >
                  {contractLabel(c)}
                </button>
              ))}
            </div>
          </section>
        )}

        {detalhe && (
          <>
            {/* -------------------------------------------------------------- */}
            {/* O contrato */}
            {/* -------------------------------------------------------------- */}
            <section className="rounded-[12px] border border-border bg-panel p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-[13.5px] font-semibold text-text">
                  Contrato v{detalhe.version}
                </h3>
                <span className="text-[11.5px] text-body">
                  modelo v{detalhe.templateVersion} · estimativa v
                  {detalhe.estimateVersion} · emitido em{' '}
                  {shortDateTime(detalhe.createdAt)}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
                <div>
                  <dt className="text-[11.5px] text-body">Valor</dt>
                  <dd className="m-0 text-[15px] font-semibold text-text">
                    {brl(detalhe.budgetBrl)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11.5px] text-body">Esforço</dt>
                  <dd className="m-0 text-[15px] font-semibold text-text">
                    {horas(detalhe.effortHours)}
                  </dd>
                </div>
              </dl>

              <details className="mt-3 rounded-[9px] border border-border2 px-3.5 py-2.5">
                <summary className="cursor-pointer text-[12px] text-body2">
                  Ver o documento
                </summary>
                {/*
                  O HTML já foi escapado na emissão e é IMUTÁVEL. Não é
                  reescapado aqui pelo mesmo motivo da página pública (PR-4):
                  reescapar transformaria `&amp;` em `&amp;amp;` e o painel
                  mostraria um documento diferente do que o cliente lê.
                */}
                <div
                  className="mt-2.5 max-h-[420px] overflow-y-auto rounded-[8px] border border-border2 bg-bg px-3.5 py-3 text-[12.5px] leading-relaxed text-text2"
                  dangerouslySetInnerHTML={{ __html: detalhe.renderedHtml }}
                />
              </details>
            </section>

            {/* -------------------------------------------------------------- */}
            {/* Link público */}
            {/* -------------------------------------------------------------- */}
            <section className="rounded-[12px] border border-border bg-panel p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-[13.5px] font-semibold text-text">
                  Link para o cliente
                </h3>
                <span className="text-[11.5px] text-body">
                  {LINK_STATE_LABEL[estadoLink]}
                  {link?.active && ` · expira em ${shortDateTime(link.expiresAt)}`}
                </span>
              </div>

              <p className="mt-2 rounded-[9px] border border-accent-border bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-text2">
                Este link mostra <strong>CPF/CNPJ e endereço completos das duas
                partes</strong>, sem pedir senha, para quem tiver a URL. Ele
                expira em 48 h e você pode revogá-lo a qualquer momento — mas
                quem já recebeu pode ter repassado.
              </p>

              {urlPublica && (
                <div className="mt-3 grid gap-2">
                  <input
                    readOnly
                    value={urlPublica}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-[8px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(urlPublica)
                          .then(() => toast.success('Link copiado'))
                          // Clipboard bloqueado (sem HTTPS, permissão negada): o
                          // campo acima é selecionável. Falhar em silêncio
                          // esconderia a saída.
                          .catch(() => toast.error('Copie manualmente do campo acima'))
                      }
                      className="rounded-[8px] bg-btnbg px-3.5 py-1.5 text-[12px] font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
                    >
                      Copiar link
                    </button>
                  </div>
                  <p className="text-[11.5px] text-body">
                    Copie agora: este endereço não é recuperável depois que a tela
                    recarregar.
                  </p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    if (needsRegenerateConfirm(estadoLink)) {
                      setConfirmarRegenerar(true);
                      return;
                    }
                    void executar(async () => {
                      const criado = await createContractLink(detalhe.id);
                      setToken(criado.token);
                      setLink(await getContractLink(detalhe.id));
                      toast.success('Link gerado — copie agora');
                    });
                  }}
                  className="rounded-[8px] border border-accent-border px-3.5 py-1.5 text-[12px] font-semibold text-text2 transition-colors duration-150 hover:bg-accent-soft disabled:opacity-50"
                >
                  {generateLabel(estadoLink)}
                </button>

                {canRevoke(estadoLink) && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      void executar(async () => {
                        await revokeContractLink(detalhe.id);
                        setToken(null);
                        setLink(await getContractLink(detalhe.id));
                        toast.success('Link revogado');
                      })
                    }
                    className="rounded-[8px] border border-border2 px-3.5 py-1.5 text-[12px] text-body2 transition-colors duration-150 hover:bg-card hover:text-text disabled:opacity-50"
                  >
                    Revogar link
                  </button>
                )}
              </div>

              {confirmarRegenerar && (
                <div className="mt-3 rounded-[9px] border border-border2 px-3.5 py-3">
                  <p className="m-0 text-[12.5px] text-text2">
                    O link atual deixa de funcionar imediatamente. Quem já o
                    recebeu perde o acesso.
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmarRegenerar(false);
                        void executar(async () => {
                          const criado = await createContractLink(detalhe.id);
                          setToken(criado.token);
                          setLink(await getContractLink(detalhe.id));
                          toast.success('Link novo gerado — copie agora');
                        });
                      }}
                      className="rounded-[8px] bg-btnbg px-3.5 py-1.5 text-[12px] font-semibold text-btnfg"
                    >
                      Regenerar mesmo assim
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmarRegenerar(false)}
                      className="rounded-[8px] border border-border2 px-3.5 py-1.5 text-[12px] text-body2"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* -------------------------------------------------------------- */}
            {/* Aceite */}
            {/* -------------------------------------------------------------- */}
            <section className="rounded-[12px] border border-border bg-panel p-4">
              <h3 className="m-0 text-[13.5px] font-semibold text-text">
                Registrar aceite
              </h3>

              {isAccepted(detalhe) ? (
                <p className="mt-2 text-[12.5px] text-text2">
                  Aceito em <strong>{shortDateTime(detalhe.acceptedAt)}</strong>. O
                  link continua válido até expirar — o cliente relê o que aceitou.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-[12px] text-body">
                    Você registra que o cliente aceitou por fora do sistema.{' '}
                    <strong>Isto não é assinatura eletrônica</strong> — é o seu
                    registro do aceite, com canal e data. É o único ato que move o
                    card do funil.
                  </p>

                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-1.5">
                      <span className="text-[11.5px] text-body">
                        Como o cliente aceitou
                      </span>
                      <select
                        value={canal}
                        onChange={(e) =>
                          setCanal(e.target.value as AcceptanceChannel)
                        }
                        className="rounded-[8px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                      >
                        {ACCEPTANCE_CHANNELS.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-1.5">
                      <span className="text-[11.5px] text-body">
                        Observação (opcional)
                      </span>
                      <textarea
                        value={observacao}
                        rows={2}
                        onChange={(e) => setObservacao(e.target.value)}
                        className="rounded-[8px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      void executar(async () => {
                        const r = await acceptContract(detalhe.id, {
                          channel: canal,
                          note: observacao.trim() || undefined,
                        });
                        if (r.alreadyAccepted) {
                          toast.success('Este contrato já estava aceito');
                        } else {
                          toast.success(
                            r.cardMoved
                              ? 'Aceite registrado — o card avançou no funil'
                              : 'Aceite registrado',
                          );
                        }
                        // `cardMoved: false` é resposta legítima (card já
                        // adiante), não erro: o aceite foi gravado do mesmo
                        // jeito, e a tela não pode sugerir que falhou.
                        if (r.cardMoved) onCardMoved?.();
                        await carregar();
                        await abrirContrato(detalhe.id);
                      })
                    }
                    className="mt-3 rounded-[8px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110 disabled:opacity-50"
                  >
                    Registrar aceite
                  </button>
                </>
              )}
            </section>
          </>
        )}

        {contratos.length === 0 && (
          <p className="text-[12.5px] text-body">
            Nenhum contrato emitido para este projeto.
          </p>
        )}
      </div>
    </Gaveta>
  );
}

/** Casca da gaveta — mesmo desenho do `EstimatePanel` e do `ArtifactsPanel`. */
function Gaveta({
  titulo,
  onClose,
  children,
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-label={`Contratos de ${titulo}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-[720px] max-w-full flex-col overflow-y-auto border-l border-border bg-bg px-6 py-5"
      >
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[15px] font-semibold text-text">
              Contratos
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-body">{titulo}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-[7px] border border-border2 px-2.5 py-1 text-[11px] text-body transition-colors hover:bg-card hover:text-text"
          >
            Fechar
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
