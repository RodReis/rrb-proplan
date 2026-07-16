import { useEffect, useState } from 'react';
import {
  api,
  DeployEnv,
  DeploySignal,
  DeploySource,
  DeployVerdictState,
  InferencePayload,
  TabSource,
} from '../../../lib/api';
import { TabFrame } from '../TabFrame';
import { MarkdownView } from '../MarkdownView';

type Payload = {
  environments: DeployEnv[];
  /** Markdown do doc mapeado (SPEC-012) — sempre renderizado quando presente. */
  markdown: string | null;
  path: string | null;
  /** SPEC-013 — drift de deploy (aditivo). */
  deployVerdict: DeployVerdictState | null;
  deploySignals: DeploySignal[] | null;
  deployObservedAt: string | null;
} & Partial<InferencePayload>;

const SOURCE_LABEL: Record<DeploySource, string> = {
  doc: 'documento de deploy',
  repoConfig: 'config no repositório',
  githubDeployments: 'GitHub Deployments',
  declaredUrl: 'URL declarada',
};

const SOURCE_NATURE: Record<DeploySource, string> = {
  doc: 'texto extraído',
  repoConfig: 'declaração de intenção',
  githubDeployments: 'registro do GitHub',
  declaredUrl: 'declaração do dono',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

/** Lista de plataformas de um sinal em pt-BR; vazio → "silenciou". */
function platformsText(platforms: string[]): string {
  if (platforms.length === 0) return 'silenciou';
  return platforms.join(' + ');
}

/** SPEC-013.6: sufixo de natureza conforme o modo da URL declarada. */
function modeSuffix(s: DeploySignal): string {
  if (s.source !== 'declaredUrl') return SOURCE_NATURE[s.source];
  if (s.mode === 'probe') return 'confirmada ao vivo';
  return SOURCE_NATURE.declaredUrl; // 'string' → declaração do dono (parse de domínio)
}

/** URLs declaradas que o probe recusou sondar por segurança (ADR-018). */
function blockedSignals(signals: DeploySignal[]): DeploySignal[] {
  return signals.filter(
    (s) => s.source === 'declaredUrl' && s.mode === 'bloqueada_por_seguranca',
  );
}

/**
 * Nota transparente (ADR-018): URLs declaradas que o probe recusou sondar
 * porque o destino não é público. Nunca silenciosa — o dono precisa saber que
 * aquela URL não foi verificada, e por quê.
 */
function BlockedNote({ signals, inline }: { signals: DeploySignal[]; inline?: boolean }) {
  if (signals.length === 0) return null;
  const body = (
    <p className="text-xs text-text-muted">
      <span className="font-medium text-warning">URL não sondada por segurança:</span>{' '}
      {signals.map((s) => s.evidenceRef).join(', ')} — o destino resolve para um endereço
      não-público; o probe não faz a requisição (ADR-018).
    </p>
  );
  return inline ? (
    <div className="mt-3 border-t border-border/50 pt-2">{body}</div>
  ) : (
    <div className="mb-6 rounded-lg border border-warning/40 bg-warning/5 p-4">{body}</div>
  );
}

/**
 * Faixa de confronto (SPEC-013). NUNCA diz "roda em X" — só "a fonte Y aponta X,
 * observado em <data>". Não rotula fonte como "congelada/resíduo". O humano
 * conclui a idade pela data.
 */
function DriftBanner({
  verdict,
  signals,
  observedAt,
}: {
  verdict: DeployVerdictState;
  signals: DeploySignal[];
  observedAt: string | null;
}) {
  if (verdict === 'concordam' || verdict === 'silencio') {
    // Mesmo concordando/em silêncio, um bloqueio de segurança é transparente.
    const blocked = blockedSignals(signals);
    return blocked.length > 0 ? <BlockedNote signals={blocked} /> : null;
  }

  const stamp = `observado em ${fmtDate(observedAt)}`;

  if (verdict === 'discordam') {
    return (
      <div className="mb-6 rounded-lg border border-error/40 bg-error/5 p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-error">
          <span aria-hidden>🔴</span> As fontes de deploy discordam sobre a plataforma
        </p>
        <p className="mb-3 text-xs text-text-muted">
          O ProPlan não afirma qual está certa — mostra cada fonte com sua natureza e data.
        </p>
        <ul className="space-y-1 text-sm">
          {signals
            .filter((s) => s.platforms.length > 0)
            .map((s, i) => (
              <li key={`${s.source}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{SOURCE_LABEL[s.source]}:</span>
                <span>{platformsText(s.platforms)}</span>
                <span className="text-xs text-text-muted">
                  ({modeSuffix(s)} · {stamp})
                </span>
              </li>
            ))}
        </ul>
        <BlockedNote signals={blockedSignals(signals)} inline />
      </div>
    );
  }

  if (verdict === 'so_github_side') {
    const platforms = platformsText(
      [...new Set(signals.flatMap((s) => s.platforms))],
    );
    return (
      <div className="mb-6 rounded-lg border border-warning/40 bg-warning/5 p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
          <span aria-hidden>⚠️</span> Sem fonte fresca para confrontar
        </p>
        <p className="text-sm text-text-muted">
          As fontes do GitHub apontam <span className="font-medium">{platforms}</span>, mas
          nenhuma é fresca ({stamp}) — deploy fora do GitHub não aparece aqui. Para confrontar,{' '}
          <span className="font-medium text-text">declare a URL de produção</span> em{' '}
          <code className="rounded bg-border/40 px-1 py-0.5 text-xs">.proplan/config.yml</code>{' '}
          (<code className="text-xs">deploy.prodUrls</code>).
        </p>
      </div>
    );
  }

  // omissa
  return (
    <div className="mb-6 rounded-lg border border-warning/40 bg-warning/5 p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
        <span aria-hidden>⚠️</span> Deployments no GitHub, sem documentação de deploy
      </p>
      <p className="text-sm text-text-muted">
        Este repositório tem deployments registrados no GitHub ({stamp}) e nenhuma doc de deploy
        mapeada. O ProPlan não infere como se faz o deploy — só aponta que falta documentação onde
        deveria haver.
      </p>
    </div>
  );
}
interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function DeployTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<Payload>(projectId, 'deploy')
      .then((res) => {
        if (!active) return;
        setSource(res.source);
        setPayload(res.payload);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, syncNonce]);

  const envs = payload?.environments ?? [];
  const markdown = payload?.markdown ?? '';
  const active = (s: string) => /ativo|active|produção|production/i.test(s);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Deploy" tabId="deploy" spans={payload?.spans} onCorrect={onCorrect}>
      {/* SPEC-013: faixa de confronto de fontes no TOPO. Só aparece quando há
          drift (discordam/so_github_side/omissa); silenciosa se concordam. */}
      {payload?.deployVerdict && (
        <DriftBanner
          verdict={payload.deployVerdict}
          signals={payload.deploySignals ?? []}
          observedAt={payload.deployObservedAt}
        />
      )}

      {/* SPEC-012: o painel de ambientes é ENRIQUECIMENTO — só aparece se a doc
          seguiu a tabela do CONVENTION.md. Fica ACIMA do documento.
          SPEC-017: eixo Componente — coluna só aparece quando algum ambiente tem
          componentes; ambiente é agrupado por rowSpan. Monolito (4 colunas) fica
          idêntico ao de antes. */}
      {envs.length > 0 &&
        (() => {
          const hasComponent = envs.some((e) => e.componente);
          // Agrupa por ambiente preservando a ordem de aparição.
          const order: string[] = [];
          const byEnv = new Map<string, DeployEnv[]>();
          for (const e of envs) {
            if (!byEnv.has(e.env)) {
              byEnv.set(e.env, []);
              order.push(e.env);
            }
            byEnv.get(e.env)!.push(e);
          }
          return (
            <table className="mb-6 w-full text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th className="pb-2">Ambiente</th>
                  {hasComponent && <th className="pb-2">Componente</th>}
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Plataforma</th>
                  <th className="pb-2">URL</th>
                </tr>
              </thead>
              <tbody>
                {order.map((env) => {
                  const rows = byEnv.get(env)!;
                  return rows.map((e, i) => (
                    <tr key={`${env}-${e.componente ?? ''}-${i}`} className="border-t border-border">
                      {i === 0 && (
                        <td className="py-2 align-top font-medium" rowSpan={rows.length}>
                          {env}
                        </td>
                      )}
                      {hasComponent && <td className="py-2 text-text-muted">{e.componente ?? '—'}</td>}
                      <td className="py-2">
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-xs ' +
                            (active(e.status) ? 'bg-success/10 text-success' : 'bg-border/50 text-text-muted')
                          }
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="py-2 text-text-muted">{e.platform}</td>
                      <td className="py-2">
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                            {e.url}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          );
        })()}

      {/* O documento mapeado SEMPRE aparece (ADR-014). Mesmo viewer de
          Arquitetura/Design — react-markdown + Mermaid lazy (Fatia 6). */}
      {markdown && <MarkdownView markdown={markdown} />}
    </TabFrame>
  );
}
