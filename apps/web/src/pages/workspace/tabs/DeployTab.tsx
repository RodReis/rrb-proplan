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
  if (verdict === 'concordam' || verdict === 'silencio') return null;

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
            .map((s) => (
              <li key={s.source} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{SOURCE_LABEL[s.source]}:</span>
                <span>{platformsText(s.platforms)}</span>
                <span className="text-xs text-text-muted">
                  ({SOURCE_NATURE[s.source]} · {stamp})
                </span>
              </li>
            ))}
        </ul>
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
    <TabFrame loading={loading} error={error} source={source} label="Deploy" spans={payload?.spans} onCorrect={onCorrect}>
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
          seguiu a tabela do CONVENTION.md. Fica ACIMA do documento. */}
      {envs.length > 0 && (
        <table className="mb-6 w-full text-sm">
          <thead className="text-left text-xs text-text-muted">
            <tr>
              <th className="pb-2">Ambiente</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Plataforma</th>
              <th className="pb-2">URL</th>
            </tr>
          </thead>
          <tbody>
            {envs.map((e) => (
              <tr key={e.env} className="border-t border-border">
                <td className="py-2 font-medium">{e.env}</td>
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
            ))}
          </tbody>
        </table>
      )}

      {/* O documento mapeado SEMPRE aparece (ADR-014). Mesmo viewer de
          Arquitetura/Design — react-markdown + Mermaid lazy (Fatia 6). */}
      {markdown && <MarkdownView markdown={markdown} />}
    </TabFrame>
  );
}
