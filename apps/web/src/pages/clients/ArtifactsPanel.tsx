import { useCallback, useEffect, useState } from 'react';
import {
  approveArtifact,
  createArtifactVersion,
  getArtifactVersion,
  getArtifacts,
  rejectArtifact,
  type ArtifactSummary,
  type ArtifactVersionDetail,
  type ArtifactsOverview,
} from '../../lib/api';
import {
  authorLabel,
  canEdit,
  canReview,
  costLabel,
  kindLabel,
  progress,
  stateLabel,
} from './artifactsView';

interface Props {
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  /** Chamado quando a aprovação move o card, para o funil recarregar. */
  onCardMoved?: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; overview: ArtifactsOverview };

/**
 * Artefatos do pipeline de IA, no painel do prestador (SPEC-032 §2.12).
 *
 * **O parecer do revisor aparece, e o botão de aprovar não olha para ele.**
 * Essa é a decisão 1 do PI em pixels: um parecer negativo é informação para a
 * pessoa decidir, nunca um bloqueio. Se o botão desabilitasse por causa do
 * veredito, a IA teria poder de veto por via indireta.
 */
export function ArtifactsPanel({ projectId, projectTitle, onClose, onCardMoved }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [aberto, setAberto] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<ArtifactVersionDetail | null>(null);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', overview: await getArtifacts(projectId) });
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

  async function abrirVersao(artifact: ArtifactSummary, versionId: string) {
    setAberto(artifact.id ?? null);
    setEditando(false);
    setErroAcao(null);
    setDetalhe(null);
    try {
      const d = await getArtifactVersion(artifact.id!, versionId);
      setDetalhe(d);
      setRascunho(JSON.stringify(d.content, null, 2));
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'falha ao carregar a versão');
    }
  }

  async function executar(acao: () => Promise<{ cardMoved: boolean }>) {
    setOcupado(true);
    setErroAcao(null);
    try {
      const out = await acao();
      if (out.cardMoved) onCardMoved?.();
      await carregar();
      setDetalhe(null);
      setAberto(null);
      setEditando(false);
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'a ação falhou');
    } finally {
      setOcupado(false);
    }
  }

  async function salvarEdicao(artifactId: string, parentVersionId: string) {
    let content: Record<string, unknown>;
    try {
      content = JSON.parse(rascunho) as Record<string, unknown>;
    } catch {
      // Validar aqui evita mandar ao servidor um corpo que ele recusaria — e a
      // mensagem fica ao lado do campo, onde a pessoa está olhando.
      setErroAcao('o conteúdo precisa ser um JSON válido');
      return;
    }
    setOcupado(true);
    setErroAcao(null);
    try {
      await createArtifactVersion(artifactId, parentVersionId, content);
      await carregar();
      setEditando(false);
      setDetalhe(null);
      setAberto(null);
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'falha ao salvar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-[12px] border border-border2 bg-pop shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={`Artefatos de ${projectTitle}`}
      >
        <header className="flex items-center justify-between border-b border-border2 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text">Artefatos</h2>
            <p className="text-sm text-text2">{projectTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-2 py-1 text-sm text-text2 hover:bg-card"
            aria-label="Fechar"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.status === 'loading' && <p className="text-sm text-text2">Carregando…</p>}

          {state.status === 'error' && (
            <p className="text-sm text-error">{state.message}</p>
          )}

          {state.status === 'ready' && (
            <Conteudo
              overview={state.overview}
              aberto={aberto}
              detalhe={detalhe}
              editando={editando}
              rascunho={rascunho}
              motivo={motivo}
              erroAcao={erroAcao}
              ocupado={ocupado}
              onAbrir={abrirVersao}
              onFecharDetalhe={() => {
                setAberto(null);
                setDetalhe(null);
                setEditando(false);
              }}
              onEditar={() => setEditando(true)}
              onRascunho={setRascunho}
              onMotivo={setMotivo}
              onAprovar={(id) => executar(() => approveArtifact(id))}
              onRejeitar={(id) => executar(() => rejectArtifact(id, motivo))}
              onSalvar={salvarEdicao}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface ConteudoProps {
  overview: ArtifactsOverview;
  aberto: string | null;
  detalhe: ArtifactVersionDetail | null;
  editando: boolean;
  rascunho: string;
  motivo: string;
  erroAcao: string | null;
  ocupado: boolean;
  onAbrir: (a: ArtifactSummary, versionId: string) => void;
  onFecharDetalhe: () => void;
  onEditar: () => void;
  onRascunho: (v: string) => void;
  onMotivo: (v: string) => void;
  onAprovar: (id: string) => void;
  onRejeitar: (id: string) => void;
  onSalvar: (artifactId: string, parentVersionId: string) => void;
}

function Conteudo(p: ConteudoProps) {
  const prog = progress(p.overview);
  const custo = costLabel(p.overview.costUsd);

  return (
    <>
      <section className="mb-4 rounded-[10px] border border-border2 bg-card px-4 py-3">
        <p className="text-sm text-text">
          <strong>
            {prog.approved} de {prog.required}
          </strong>{' '}
          {prog.approved === 1 ? 'aprovado' : 'aprovados'}
          {prog.complete && ' — o projeto avançou no funil'}
        </p>
        {prog.blocked && <p className="mt-1 text-sm text-text2">{prog.blocked}</p>}
        {custo && (
          <p className="mt-1 text-xs text-text2">
            Custo desta geração: {custo}{' '}
            <span title="Somado do registro de consumo, não estimado">(do ledger)</span>
          </p>
        )}
      </section>

      <ul className="flex flex-col gap-3">
        {p.overview.artifacts.map((a) => (
          <li
            key={a.kind}
            className="rounded-[10px] border border-border2 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-text">{kindLabel(a.kind)}</h3>
                <p className="text-xs text-text2">{stateLabel(a.state)}</p>
              </div>
              {a.versions.length > 0 && (
                <button
                  type="button"
                  onClick={() => p.onAbrir(a, a.versions[0].id)}
                  className="rounded-[8px] border border-border2 px-3 py-1 text-sm text-text hover:bg-card"
                >
                  Ver
                </button>
              )}
            </div>

            {a.state === 'REJECTED' && a.rejectionReason && (
              <p className="mt-2 text-xs text-error">Rejeitado: {a.rejectionReason}</p>
            )}

            {a.versions.length > 1 && (
              <p className="mt-2 text-xs text-text2">
                {a.versions.length} versões — a mais nova é {authorLabel(a.versions[0])}
              </p>
            )}

            {p.aberto === a.id && (
              <Detalhe
                artifact={a}
                detalhe={p.detalhe}
                editando={p.editando}
                rascunho={p.rascunho}
                motivo={p.motivo}
                erroAcao={p.erroAcao}
                ocupado={p.ocupado}
                onFechar={p.onFecharDetalhe}
                onEditar={p.onEditar}
                onRascunho={p.onRascunho}
                onMotivo={p.onMotivo}
                onAprovar={p.onAprovar}
                onRejeitar={p.onRejeitar}
                onSalvar={p.onSalvar}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

interface DetalheProps {
  artifact: ArtifactSummary;
  detalhe: ArtifactVersionDetail | null;
  editando: boolean;
  rascunho: string;
  motivo: string;
  erroAcao: string | null;
  ocupado: boolean;
  onFechar: () => void;
  onEditar: () => void;
  onRascunho: (v: string) => void;
  onMotivo: (v: string) => void;
  onAprovar: (id: string) => void;
  onRejeitar: (id: string) => void;
  onSalvar: (artifactId: string, parentVersionId: string) => void;
}

function Detalhe(p: DetalheProps) {
  const { artifact, detalhe } = p;
  if (!detalhe) {
    return (
      <p className="mt-3 text-sm text-text2">
        {p.erroAcao ?? 'Carregando a versão…'}
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-border2 pt-3">
      <p className="text-xs text-text2">
        v{detalhe.version} · {authorLabel(detalhe)}
        {detalhe.model && ` · ${detalhe.model}`}
      </p>

      {/* O parecer do revisor. Aparece SEMPRE que existe, e nunca desabilita o
          botão de aprovar (§2.9, decisão 1 do PI): anota, nunca bloqueia. */}
      {detalhe.verdicts.length > 0 && (
        <aside className="mt-3 rounded-[8px] border border-border2 bg-card px-3 py-2">
          <p className="text-xs font-semibold text-text">
            Revisor: {detalhe.verdicts[0].verdict}
          </p>
          <p className="mt-1 whitespace-pre-line text-xs text-text2">
            {detalhe.verdicts[0].rationale}
          </p>
          <p className="mt-1 text-[11px] text-text2">
            É uma anotação — quem decide é você.
          </p>
        </aside>
      )}

      {p.editando ? (
        <div className="mt-3">
          <label className="text-xs text-text2" htmlFor={`edit-${artifact.kind}`}>
            Conteúdo (JSON)
          </label>
          <textarea
            id={`edit-${artifact.kind}`}
            value={p.rascunho}
            onChange={(e) => p.onRascunho(e.target.value)}
            rows={12}
            className="mt-1 w-full rounded-[8px] border border-border2 bg-pop px-3 py-2 font-mono text-xs text-text"
          />
          <p className="mt-1 text-[11px] text-text2">
            Salvar cria uma versão nova. A versão da IA continua guardada.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={p.ocupado}
              onClick={() => p.onSalvar(artifact.id!, detalhe.id)}
              className="rounded-[8px] bg-accent px-3 py-1 text-sm text-pop disabled:opacity-50"
            >
              Salvar como versão nova
            </button>
            <button
              type="button"
              onClick={p.onFechar}
              className="rounded-[8px] border border-border2 px-3 py-1 text-sm text-text"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <pre className="mt-3 max-h-64 overflow-auto rounded-[8px] bg-card px-3 py-2 font-mono text-xs text-text">
          {JSON.stringify(detalhe.content, null, 2)}
        </pre>
      )}

      {p.erroAcao && <p className="mt-2 text-xs text-error">{p.erroAcao}</p>}

      {!p.editando && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canReview(artifact) && (
            <>
              <button
                type="button"
                disabled={p.ocupado}
                onClick={() => p.onAprovar(artifact.id!)}
                className="rounded-[8px] bg-accent px-3 py-1 text-sm text-pop disabled:opacity-50"
              >
                Aprovar
              </button>
              <input
                value={p.motivo}
                onChange={(e) => p.onMotivo(e.target.value)}
                placeholder="motivo da rejeição"
                aria-label="Motivo da rejeição"
                className="flex-1 rounded-[8px] border border-border2 bg-pop px-3 py-1 text-sm text-text"
              />
              <button
                type="button"
                disabled={p.ocupado || p.motivo.trim() === ''}
                onClick={() => p.onRejeitar(artifact.id!)}
                className="rounded-[8px] border border-border2 px-3 py-1 text-sm text-text disabled:opacity-50"
              >
                Rejeitar
              </button>
            </>
          )}
          {canEdit(artifact) && (
            <button
              type="button"
              onClick={p.onEditar}
              className="rounded-[8px] border border-border2 px-3 py-1 text-sm text-text"
            >
              Editar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
