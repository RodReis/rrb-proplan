import { useCallback, useEffect, useState } from 'react';
import {
  briefingAttachmentUrl,
  getBriefingVersion,
  type BriefingVersionDetail,
  type BriefingVersionRef,
} from '../../lib/api';
import { STEPS, isBlank } from '../briefing/steps';

interface Props {
  /** Versões do projeto, mais nova primeiro. Nunca vazia aqui. */
  versions: BriefingVersionRef[];
  projectTitle: string;
  onClose: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: BriefingVersionDetail };

/**
 * O briefing enviado, em LEITURA (SPEC-031 §6).
 *
 * **Não existe modo de edição, e a ausência é o ponto.** A `BriefingVersion` é
 * imutável (§5): o que o cliente enviou é o que fica, e nem o prestador nem a
 * IA reescrevem. Por isso nenhum campo aqui é `input` — são `dd` de uma lista
 * de definição, que é o que o dado realmente é.
 *
 * Todos os papéis abrem, inclusive `viewer` (critério de aceite: *"`viewer`
 * consegue ler o briefing e baixar anexo; nenhum papel tem controle de
 * edição"*). Não há `canWrite` neste componente de propósito.
 */
export function BriefingVersionPanel({ versions, projectTitle, onClose }: Props) {
  const [selected, setSelected] = useState(versions[0].id);
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', detail: await getBriefingVersion(selected) });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar',
      });
    }
  }, [selected]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-[12px] border border-border2 bg-pop shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={`Briefing de ${projectTitle}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              Briefing recebido · somente leitura
            </span>
            <h2 className="mt-1 truncate text-base font-semibold text-text2">
              {projectTitle}
            </h2>
            {state.status === 'ready' && (
              <p className="mt-0.5 text-xs text-muted">
                Versão {state.detail.version} · enviado em{' '}
                {fullDate(state.detail.submittedAt)}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Seletor só quando há mais de uma: regenerar o link cria a v2 e a
                v1 PERMANECE legível (spec §5). Com uma só, o select seria ruído. */}
            {versions.length > 1 && (
              <label className="text-xs text-muted">
                <span className="sr-only">Versão do briefing</span>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="h-8 rounded-[8px] border border-border2 bg-panel px-2 text-xs text-text outline-none focus:border-hoverb"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      Versão {v.version} · {shortDate(v.submittedAt)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar briefing"
              className="grid h-8 w-8 place-items-center rounded-[8px] text-muted transition-colors duration-150 hover:bg-card hover:text-text"
            >
              ×
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {state.status === 'loading' && (
            <div className="space-y-2">
              <div className="h-14 animate-pulse rounded-md bg-surface-hover" />
              <div className="h-14 animate-pulse rounded-md bg-surface-hover" />
              <div className="h-14 animate-pulse rounded-md bg-surface-hover" />
            </div>
          )}

          {state.status === 'error' && (
            <div className="rounded-md border border-warning bg-surface px-4 py-3">
              <p className="text-sm font-semibold text-warning-strong">
                Não foi possível carregar o briefing.
              </p>
              <p className="mt-1 break-words font-mono text-[11px] text-faint">
                {state.message}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 rounded-md border border-border2 px-3 py-1.5 text-xs font-semibold text-text2 hover:bg-surface-hover"
              >
                Tentar de novo
              </button>
            </div>
          )}

          {state.status === 'ready' && <VersionBody detail={state.detail} />}
        </div>
      </div>
    </div>
  );
}

/** As 9 etapas com as respostas, mais os anexos. */
function VersionBody({ detail }: { detail: BriefingVersionDetail }) {
  return (
    <>
      <dl className="space-y-4">
        {STEPS.map((s) => {
          const given = detail.answers[String(s.n)] ?? {};
          const filled = s.fields.filter((f) => !isBlank(given[f.name]));

          return (
            <div key={s.n} className="rounded-[10px] border border-border bg-surface px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-faint">
                {s.n}. {s.title}
              </dt>

              {filled.length === 0 ? (
                <dd className="mt-1.5 text-xs italic text-dim">Não informado</dd>
              ) : (
                filled.map((f) => (
                  <dd key={f.name} className="mt-1.5 text-xs leading-relaxed text-body2">
                    <span className="text-faint">{f.label}: </span>
                    {display(
                      given[f.name],
                      f.options,
                      detail.labels[`${s.n}.${f.name}`],
                    )}
                  </dd>
                ))
              )}
            </div>
          );
        })}
      </dl>

      <Attachments files={detail.attachments} />
    </>
  );
}

function Attachments({
  files,
}: {
  files: BriefingVersionDetail['attachments'];
}) {
  return (
    <section className="mt-4 rounded-[10px] border border-border bg-surface px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">
        Anexos
      </h3>

      {files.length === 0 ? (
        <p className="mt-1.5 text-xs italic text-dim">Nenhum arquivo enviado.</p>
      ) : (
        <ul className="mt-2 grid list-none gap-1.5 p-0">
          {files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-body2">{file.name}</span>
              <a
                // `href` normal, não `fetch`: o browser precisa do
                // `Content-Disposition: attachment` para salvar o arquivo, e a
                // sessão viaja no cookie httpOnly.
                href={briefingAttachmentUrl(file.id)}
                className="shrink-0 rounded-[8px] border border-accent-border px-2.5 py-1 text-[11px] font-semibold text-text2 transition-colors duration-150 hover:bg-accent-soft"
              >
                Baixar · {formatSize(file.size)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * O valor legível.
 *
 * `label` vem do servidor e VENCE as opções fixas: segmento, estado e cidade
 * são gravados por código e só o servidor sabe traduzi-los — mostrar `G` seria
 * repetir o bug que o dogfooding do PR-3 pegou na revisão.
 */
function display(
  value: unknown,
  options?: readonly { value: string; label: string }[],
  label?: string,
): string {
  if (label) return label;
  if (Array.isArray(value)) return value.join(', ');
  if (value === true) return 'Sim';
  const text = String(value ?? '');
  return options?.find((o) => o.value === text)?.label ?? text;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Data no fuso de quem lê, não em UTC.
 *
 * O `submittedAt` chega em `Z`; recortar a string mostraria 21/07 para um envio
 * das 22h de 20/07 no Brasil — "recebido em" com o dia errado. `toLocale*` é o
 * que o resto do painel já usa.
 */
function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('pt-BR');
}

function fullDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
