import { useCallback, useEffect, useState } from 'react';
import {
  approveEstimate,
  generateEffortBreakdown,
  generateEstimate,
  getEffortBreakdown,
  getEstimate,
  getEstimateSettings,
  listEstimates,
  updateEstimateSettings,
  type EffortBreakdownView,
  type EstimateDetail,
  type EstimateListItem,
  type EstimateSettings,
} from '../../lib/api';
import {
  SCENARIOS,
  aiCostLines,
  brl,
  complexityLabel,
  effortBlockedReason,
  horas,
  isApproved,
  scenarioLines,
} from './estimatesView';

interface Props {
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  /** Chamado quando a aprovação move o card, para o funil recarregar. */
  onCardMoved?: () => void;
}

interface Dados {
  effort: EffortBreakdownView;
  versoes: EstimateListItem[];
  settings: EstimateSettings;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dados: Dados };

interface CustoDireto {
  label: string;
  valueBrl: string;
}

/**
 * Estimativa no painel do prestador (SPEC-033).
 *
 * **Dois "aprovar", e eles não podem parecer o mesmo botão** (§7.1). Aprovar a
 * *decomposição* é revisão de artefato e não move nada; aprovar a *estimativa*
 * move o card para `CONTRACT_PENDING`. Os rótulos dizem isso explicitamente —
 * se a tela os igualasse, a decisão do PI viraria ambígua na prática.
 *
 * **Nada aqui recalcula.** Os cenários chegam prontos do servidor, com
 * `subtotal`, `contingencia` e `total` separados. Uma tela que refaz a conta é
 * uma segunda implementação da regra, e ela diverge na primeira correção.
 */
export function EstimatePanel({ projectId, projectTitle, onClose, onCardMoved }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [detalhe, setDetalhe] = useState<EstimateDetail | null>(null);
  const [custos, setCustos] = useState<CustoDireto[]>([]);
  const [projecaoManual, setProjecaoManual] = useState('');
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [effort, lista, settings] = await Promise.all([
        getEffortBreakdown(projectId),
        listEstimates(projectId),
        getEstimateSettings(),
      ]);
      setState({
        status: 'ready',
        dados: { effort, versoes: lista.estimates, settings },
      });
      // Abre a versão mais recente por padrão: quem entra no painel quer ver o
      // número, não escolher qual número ver.
      if (lista.estimates.length > 0) {
        setDetalhe(await getEstimate(lista.estimates[0].id));
      }
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar',
      });
    }
  }, [projectId]);

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
      // Sem isto, uma recusa do servidor deixaria a tela igual e a pessoa
      // acharia que funcionou.
      setErroAcao(err instanceof Error ? err.message : 'a ação falhou');
    } finally {
      setOcupado(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <Moldura titulo={projectTitle} onClose={onClose}>
        <p className="text-sm text-text-muted">Carregando…</p>
      </Moldura>
    );
  }

  if (state.status === 'error') {
    return (
      <Moldura titulo={projectTitle} onClose={onClose}>
        <p className="text-sm text-danger">{state.message}</p>
      </Moldura>
    );
  }

  const { effort, versoes, settings } = state.dados;
  const bloqueio = effortBlockedReason(effort);
  const decomposicaoAprovada = effort.artifact.state === 'APPROVED';

  return (
    <Moldura titulo={projectTitle} onClose={onClose}>
      {erroAcao && (
        <p className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {erroAcao}
        </p>
      )}

      <Parametros
        settings={settings}
        ocupado={ocupado}
        onSalvar={(patch) =>
          executar(async () => {
            const novo = await updateEstimateSettings(patch);
            setState({ status: 'ready', dados: { ...state.dados, settings: novo } });
          })
        }
      />

      <section className="mt-5 border-t border-border pt-4">
        <h4 className="mb-1 text-sm font-medium">1. Decomposição de esforço</h4>
        <p className="mb-2 text-xs text-text-muted">
          A IA propõe as tarefas e a faixa de horas. Ela <strong>não</strong> soma nem
          calcula preço — isso é feito aqui pelo sistema, no passo 2.
        </p>

        {bloqueio ? (
          <p className="text-xs text-text-muted">{bloqueio}</p>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={() =>
              executar(async () => {
                await generateEffortBreakdown(projectId);
                await carregar();
              })
            }
            className="rounded-md bg-btnbg px-3 py-1.5 text-sm text-btnfg disabled:opacity-50"
          >
            {effort.artifact.versions.length > 0
              ? 'Gerar decomposição de novo'
              : 'Gerar decomposição'}
          </button>
        )}

        <p className="mt-2 text-xs text-text-muted">
          Estado: <strong>{estadoDecomposicao(effort)}</strong>
          {effort.run?.status === 'FAILED' && effort.run.failureReason && (
            <> — {effort.run.failureReason}</>
          )}
        </p>

        {effort.artifact.versions.length > 0 && !decomposicaoAprovada && (
          <p className="mt-1 text-xs text-text-muted">
            Revise e <strong>aprove a decomposição</strong> no painel de Artefatos antes de
            calcular. Aprovar a decomposição <strong>não</strong> move o card.
          </p>
        )}
      </section>

      <section className="mt-5 border-t border-border pt-4">
        <h4 className="mb-1 text-sm font-medium">2. Cálculo da estimativa</h4>
        <p className="mb-2 text-xs text-text-muted">
          Somas, multiplicações e contingência — feitas pelo sistema, com cada número
          mostrando a sua conta.
        </p>

        {!decomposicaoAprovada ? (
          <p className="text-xs text-text-muted">
            A decomposição precisa estar aprovada antes de calcular.
          </p>
        ) : (
          <>
            <CustosDiretos
              custos={custos}
              onChange={setCustos}
              disabled={ocupado}
            />
            <label className="mt-2 flex flex-col gap-1 text-xs text-text-muted">
              Projeção de custo de IA (US$) — usada só quando o workspace tem menos de 3
              execuções concluídas
              <input
                type="number"
                min={0}
                step="0.0001"
                value={projecaoManual}
                disabled={ocupado}
                onChange={(e) => setProjecaoManual(e.target.value)}
                className="w-32 rounded-md border border-border px-3 py-1.5 text-sm tabular-nums"
              />
            </label>
            <button
              type="button"
              disabled={ocupado}
              onClick={() =>
                executar(async () => {
                  const nova = await generateEstimate(projectId, {
                    directCosts: custos.filter((c) => c.label.trim() !== ''),
                    aiCostProjectedUsd: projecaoManual || undefined,
                  });
                  setDetalhe(nova);
                  await carregar();
                })
              }
              className="mt-2 rounded-md bg-btnbg px-3 py-1.5 text-sm text-btnfg disabled:opacity-50"
            >
              {versoes.length > 0 ? 'Recalcular (cria versão nova)' : 'Calcular estimativa'}
            </button>
            {versoes.length > 0 && (
              <p className="mt-1 text-xs text-text-muted">
                Recalcular <strong>cria uma versão nova</strong> e não apaga a anterior. Se a
                estimativa já foi aprovada, o card <strong>não</strong> volta.
              </p>
            )}
          </>
        )}
      </section>

      {versoes.length > 0 && (
        <section className="mt-5 border-t border-border pt-4">
          <h4 className="mb-2 text-sm font-medium">Versões</h4>
          <ul className="flex flex-wrap gap-1.5">
            {versoes.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() =>
                    executar(async () => setDetalhe(await getEstimate(v.id)))
                  }
                  className={`rounded-md border px-2 py-1 text-xs ${
                    detalhe?.id === v.id
                      ? 'border-accent-border bg-accent-soft'
                      : 'border-border'
                  }`}
                >
                  v{v.version}
                  {v.totalProvavelBrl && <> · {brl(v.totalProvavelBrl)}</>}
                  {v.approvedAt && ' · aprovada'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detalhe && (
        <Detalhe
          estimate={detalhe}
          ocupado={ocupado}
          onAprovar={() =>
            executar(async () => {
              const out = await approveEstimate(detalhe.id);
              if (out.cardMoved) onCardMoved?.();
              setDetalhe(await getEstimate(detalhe.id));
              await carregar();
            })
          }
        />
      )}
    </Moldura>
  );
}

/** Estado legível da decomposição. `null` ≠ `FAILED` — um não rodou, o outro falhou. */
function estadoDecomposicao(effort: EffortBreakdownView): string {
  const labels: Record<string, string> = {
    PENDING_REVIEW: 'aguardando sua revisão',
    APPROVED: 'aprovada',
    REJECTED: 'rejeitada',
    FAILED: 'falhou',
  };
  if (effort.artifact.state === null) return 'não gerada';
  return labels[effort.artifact.state] ?? effort.artifact.state;
}

function Moldura({
  titulo,
  onClose,
  children,
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="card-drawer w-full max-w-3xl rounded-lg bg-surface p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-medium">Estimativa</h3>
            <p className="text-xs text-text-muted">{titulo}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md border border-border px-2 py-1 text-xs"
          >
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Parâmetros do workspace (§2.6). **Só o `owner` edita** — `canEdit` vem do
 * servidor, e quem não pode vê os números sem campo editável: um campo que a API
 * vai recusar é botão morto, e pior, um que parece ter salvado.
 */
function Parametros({
  settings,
  ocupado,
  onSalvar,
}: {
  settings: EstimateSettings;
  ocupado: boolean;
  onSalvar: (patch: {
    hourlyRateBrl?: string;
    contingencyPercent?: string;
    exchangeRateUsdBrl?: string | null;
  }) => void;
}) {
  const campo = (
    label: string,
    prefixo: string,
    value: string,
    key: 'hourlyRateBrl' | 'contingencyPercent',
  ) => (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      {label}
      <div className="flex items-center gap-1.5">
        <span>{prefixo}</span>
        {settings.canEdit ? (
          <input
            type="number"
            min={0}
            step="0.01"
            defaultValue={value}
            disabled={ocupado}
            onBlur={(e) => {
              if (e.target.value !== value) onSalvar({ [key]: e.target.value });
            }}
            className="w-24 rounded-md border border-border px-3 py-1.5 text-sm tabular-nums"
          />
        ) : (
          <span className="w-24 px-3 py-1.5 text-sm tabular-nums">{value}</span>
        )}
      </div>
    </label>
  );

  return (
    <section>
      <h4 className="mb-1 text-sm font-medium">Parâmetros do workspace</h4>
      <p className="mb-2 text-xs text-text-muted">
        {settings.canEdit
          ? 'Valem para as próximas estimativas. As já calculadas guardam os valores usados na época.'
          : 'Só o dono do workspace altera estes valores.'}
      </p>
      <div className="flex flex-wrap gap-4">
        {campo('Valor/hora', 'R$', settings.hourlyRateBrl, 'hourlyRateBrl')}
        {campo('Contingência', '%', settings.contingencyPercent, 'contingencyPercent')}
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Câmbio USD→BRL
          <div className="flex items-center gap-1.5">
            <span>R$</span>
            {settings.canEdit ? (
              <input
                type="number"
                min={0}
                step="0.0001"
                defaultValue={settings.exchangeRateUsdBrl ?? ''}
                disabled={ocupado}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (settings.exchangeRateUsdBrl ?? '')) {
                    // Vazio LIMPA a taxa (manda `null`), em vez de gravar zero:
                    // cotação velha é pior que nenhuma, porque segue exibida
                    // como se fosse corrente.
                    onSalvar({ exchangeRateUsdBrl: v === '' ? null : v });
                  }
                }}
                className="w-28 rounded-md border border-border px-3 py-1.5 text-sm tabular-nums"
              />
            ) : (
              <span className="w-28 px-3 py-1.5 text-sm tabular-nums">
                {settings.exchangeRateUsdBrl ?? 'não informado'}
              </span>
            )}
          </div>
        </label>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {settings.exchangeRateUsdBrl
          ? `Taxa informada em ${new Date(settings.exchangeRateAt!).toLocaleDateString('pt-BR')}.`
          : 'Sem taxa informada: o custo de IA aparece em US$ e fica fora do total em R$.'}
      </p>
    </section>
  );
}

/** Custos diretos digitados à mão (§2.7) — sem catálogo nesta fatia. */
function CustosDiretos({
  custos,
  onChange,
  disabled,
}: {
  custos: CustoDireto[];
  onChange: (c: CustoDireto[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1 text-xs text-text-muted">Custos diretos (opcional)</p>
      {custos.map((c, i) => (
        <div key={i} className="mb-1 flex gap-1.5">
          <input
            placeholder="Descrição"
            value={c.label}
            disabled={disabled}
            onChange={(e) => {
              const novo = [...custos];
              novo[i] = { ...novo[i], label: e.target.value };
              onChange(novo);
            }}
            className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="0,00"
            value={c.valueBrl}
            disabled={disabled}
            onChange={(e) => {
              const novo = [...custos];
              novo[i] = { ...novo[i], valueBrl: e.target.value };
              onChange(novo);
            }}
            className="w-28 rounded-md border border-border px-3 py-1.5 text-sm tabular-nums"
          />
          <button
            type="button"
            aria-label="Remover custo"
            disabled={disabled}
            onClick={() => onChange(custos.filter((_, j) => j !== i))}
            className="rounded-md border border-border px-2 text-xs"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...custos, { label: '', valueBrl: '0' }])}
        className="rounded-md border border-border px-2 py-1 text-xs"
      >
        + custo direto
      </button>
    </div>
  );
}

/** A conta inteira de uma versão — cada número com a sua parcela visível. */
function Detalhe({
  estimate,
  ocupado,
  onAprovar,
}: {
  estimate: EstimateDetail;
  ocupado: boolean;
  onAprovar: () => void;
}) {
  const ia = aiCostLines(estimate);
  const aprovada = isApproved(estimate);

  return (
    <section className="mt-5 border-t border-border pt-4">
      <h4 className="mb-1 text-sm font-medium">
        Estimativa v{estimate.version}
        {aprovada && ' · aprovada'}
      </h4>
      <p className="mb-3 text-xs text-text-muted">
        Valor/hora {brl(estimate.hourlyRateBrl)} · contingência{' '}
        {estimate.contingencyPercent}% · acabamento{' '}
        {complexityLabel(estimate.complexity)} (×{Number(estimate.complexityFactor)})
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {SCENARIOS.map(({ key, label }) => (
          <div key={key} className="rounded-md border border-border p-3">
            <p className="mb-1.5 text-xs font-medium">{label}</p>
            <dl className="text-xs">
              {scenarioLines(estimate.scenarios[key]).map((linha) => (
                <div key={linha.label} className="flex justify-between gap-2 py-0.5">
                  <dt className={linha.emphasis ? 'font-medium' : 'text-text-muted'}>
                    {linha.label}
                  </dt>
                  <dd className={`tabular-nums ${linha.emphasis ? 'font-medium' : ''}`}>
                    {linha.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {estimate.mvpBreakdown.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium">Decomposição em MVPs</p>
          <p className="mb-1.5 text-xs text-text-muted">
            Subtotais do cenário provável, sem contingência — ela é do orçamento, não do
            grupo.
          </p>
          <ul className="text-xs">
            {estimate.mvpBreakdown.map((g) => (
              <li key={g.mvp} className="flex justify-between gap-2 py-0.5">
                <span className="text-text-muted">
                  {g.mvp} · {g.tarefas} tarefa{g.tarefas === 1 ? '' : 's'}
                </span>
                <span className="tabular-nums">
                  {horas(g.horas)} · {brl(g.custoBrl)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-1 text-xs font-medium">Custo de IA</p>
        <ul className="text-xs">
          <li className="flex justify-between gap-2 py-0.5">
            <span className="text-text-muted">Consumido (do ledger)</span>
            <span className="tabular-nums">{ia.incurred}</span>
          </li>
          <li className="flex justify-between gap-2 py-0.5">
            <span className="text-text-muted">Previsto — {ia.projectedNote}</span>
            <span className="tabular-nums">{ia.projected}</span>
          </li>
        </ul>
        {ia.outsideTotal && (
          <p className="mt-1 text-xs text-text-muted">{ia.outsideTotal}</p>
        )}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        {aprovada ? (
          <p className="text-xs text-text-muted">
            Aprovada em {new Date(estimate.approvedAt!).toLocaleString('pt-BR')}. O card foi
            para <strong>Contrato pendente</strong>.
          </p>
        ) : (
          <>
            <button
              type="button"
              disabled={ocupado}
              onClick={onAprovar}
              className="rounded-md bg-btnbg px-3 py-1.5 text-sm text-btnfg disabled:opacity-50"
            >
              Aprovar estimativa e avançar o card
            </button>
            <p className="mt-1 text-xs text-text-muted">
              Este é o botão que <strong>move o card</strong> para “Contrato pendente” — não
              confundir com aprovar a decomposição, que só marca as tarefas como revisadas.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
