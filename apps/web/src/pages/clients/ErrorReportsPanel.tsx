import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getLicErrorReport,
  listLicErrorGroups,
  listLicErrorReports,
  purgeLicErrorReports,
  setLicErrorReportStatus,
  type LicCatalogResponse,
  type LicErrorGroupView,
  type LicErrorReportDetail,
  type LicErrorReportView,
} from '../../lib/api';
import { shortDateTime } from './licensingView';
import {
  errorStatusLabel,
  errorStatusTone,
  newCount,
  nextStatus,
  nextStatusLabel,
  sessionTailText,
  sourceLabel,
  versionsOf,
} from './errorReportView';
import { Cartao, Etiqueta, LinhaCartao, TituloSecao, type Tom } from './licensingUi';

/**
 * Relatos de erro do app licenciado (SPEC-043) — **a aba Erros**.
 *
 * ## A pergunta que esta tela responde
 *
 * *"O que está quebrando na máquina de quem pagou, e para quem eu respondo?"*
 * Antes desta fatia não havia canal nenhum: o único tráfego externo do War Room
 * era licenciamento, e um bug em produção só chegava se o comprador escrevesse.
 *
 * ## Duas leituras da mesma tabela, e a ordem é deliberada
 *
 * **Agrupado primeiro, lista depois.** Quem abre a aba quer saber *o que* está
 * quebrando, não *quando* — e uma lista cronológica de crashes mostra vinte
 * linhas do mesmo erro antes de revelar que são o mesmo erro. O agrupamento
 * responde "onde dói" numa olhada; a lista responde "quem foi afetado".
 *
 * ## O e-mail do comprador só aparece no detalhe
 *
 * A lista não o traz de propósito. Ele vem por correlação server-side (a tabela
 * não tem coluna de e-mail) e é dado pessoal — carregá-lo em toda linha o
 * exporia a cada abertura da aba, para todo relato, sem ninguém ter pedido.
 * `sessionTail` segue a mesma regra, e por um motivo mais forte: é o campo que o
 * PI aceitou sob mitigação, porque carrega nomes de arquivos do projeto do
 * usuário.
 */

const FILTROS: Array<{ valor: string; label: string }> = [
  { valor: 'NEW', label: 'Novos' },
  { valor: 'TRIAGED', label: 'Em análise' },
  { valor: 'RESOLVED', label: 'Resolvidos' },
  { valor: '', label: 'Todos' },
];

const TOM: Record<'ok' | 'alert' | 'muted', Tom> = {
  ok: 'ok',
  alert: 'erro',
  muted: 'neutro',
};

export function ErrorReportsPanel({ catalogo }: { catalogo: LicCatalogResponse }) {
  // `NEW` é o filtro inicial: é o único estado que pede ação, e abrir em "todos"
  // enterraria o que ninguém olhou sob meses de histórico já resolvido.
  const [filtro, setFiltro] = useState('NEW');
  const [produtoId, setProdutoId] = useState('');
  const [versao, setVersao] = useState('');
  const [relatos, setRelatos] = useState<LicErrorReportView[]>([]);
  const [grupos, setGrupos] = useState<LicErrorGroupView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState<LicErrorReportDetail | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const filtros = {
        status: filtro || undefined,
        productId: produtoId || undefined,
        appVersion: versao || undefined,
      };
      // Em paralelo: são duas leituras da mesma tabela e nenhuma depende da
      // outra. Encadeá-las dobraria o tempo de abertura da aba sem ganho.
      const [lista, agrupado] = await Promise.all([
        listLicErrorReports(filtros),
        listLicErrorGroups(filtros),
      ]);
      setRelatos(lista);
      setGrupos(agrupado);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }, [filtro, produtoId, versao]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function abrir(id: string) {
    try {
      setAberto(await getLicErrorReport(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível abrir');
    }
  }

  async function triar(relato: LicErrorReportView) {
    setOcupado(true);
    try {
      await setLicErrorReportStatus(relato.id, nextStatus(relato.status));
      await carregar();
      // A gaveta fica com o estado velho depois da troca; fechá-la é mais
      // honesto que exibir um status que já não é o do banco.
      if (aberto?.id === relato.id) setAberto(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível mudar o status');
    } finally {
      setOcupado(false);
    }
  }

  async function purgar() {
    setOcupado(true);
    try {
      const { removed } = await purgeLicErrorReports();
      toast.success(
        removed === 0
          ? 'Nenhum relato passou dos 90 dias'
          : `${removed} relato(s) com mais de 90 dias apagado(s)`,
      );
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível executar o purge');
    } finally {
      setOcupado(false);
    }
  }

  const novos = newCount(relatos);
  const versoes = versionsOf(relatos);

  return (
    <div className="grid gap-3">
      <Cartao tom={novos > 0 ? 'erro' : 'neutro'}>
        <TituloSecao
          titulo="Erros relatados pelo app"
          descricao="O que quebrou na máquina de quem comprou — só quem aceitou enviar."
          etiqueta={
            novos > 0 ? (
              <Etiqueta tom="erro">
                {novos} {novos === 1 ? 'novo' : 'novos'}
              </Etiqueta>
            ) : undefined
          }
          acoes={
            <div
              className="flex flex-wrap gap-0.5 rounded-[10px] border border-border2 bg-panel p-0.5"
              role="group"
              aria-label="Filtrar por status"
            >
              {FILTROS.map((f) => (
                <button
                  key={f.valor}
                  onClick={() => setFiltro(f.valor)}
                  aria-pressed={filtro === f.valor}
                  className={
                    'rounded-[8px] px-2.5 py-1 text-[11.5px] transition-colors duration-150 ' +
                    (filtro === f.valor
                      ? 'bg-card font-semibold text-text'
                      : 'text-body2 hover:bg-card/60 hover:text-text')
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[11.5px] text-body2">
            Produto
            <select
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
              className="ml-1.5 rounded-[9px] border border-border2 bg-card px-2 py-1 text-[11.5px] text-text"
            >
              <option value="">todos</option>
              {catalogo.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {/* As versões vêm dos próprios relatos — nenhuma rota nova só para
              listá-las, e o filtro nunca oferece uma versão sem resultado. */}
          <label className="text-[11.5px] text-body2">
            Versão
            <select
              value={versao}
              onChange={(e) => setVersao(e.target.value)}
              className="ml-1.5 rounded-[9px] border border-border2 bg-card px-2 py-1 text-[11.5px] text-text"
            >
              <option value="">todas</option>
              {versoes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* O agrupamento vem ANTES da lista: quem abre a aba quer saber o que
            está quebrando, não quando. Uma lista cronológica mostra vinte linhas
            do mesmo erro antes de revelar que são o mesmo erro. */}
        {grupos.length > 1 && (
          <ul className="mt-4 grid list-none gap-1.5 p-0">
            {grupos.slice(0, 5).map((g) => (
              <li
                key={g.message}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border2 bg-panel px-3 py-2"
              >
                <span className="min-w-0 truncate text-[12.5px] text-text">{g.message}</span>
                <span className="shrink-0 text-[11.5px] text-body2">
                  {g.count}× · último em {shortDateTime(g.lastReceivedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {carregando ? (
          <div
            aria-hidden
            className="mt-4 h-20 animate-pulse rounded-[11px] border border-border2 bg-card"
          />
        ) : relatos.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-[12.5px] text-body">
            {filtro === 'NEW' ? (
              <>
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                Nenhum relato novo — nada quebrou, ou nada foi enviado.
              </>
            ) : (
              'Nenhum relato neste filtro.'
            )}
          </p>
        ) : (
          <ul className="mt-4 grid list-none gap-2 p-0">
            {relatos.map((r) => {
              const tom = TOM[errorStatusTone(r.status)];
              return (
                <LinhaCartao key={r.id} tom={tom}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 truncate text-[13.5px] text-text">{r.message}</p>
                      <p className="m-0 mt-0.5 text-[11.5px] text-body2">
                        {r.appVersion} · {r.os} · {sourceLabel(r.source)} · recebido em{' '}
                        {shortDateTime(r.receivedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Etiqueta tom={tom}>{errorStatusLabel(r.status)}</Etiqueta>
                      <button
                        onClick={() => void abrir(r.id)}
                        className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-text2 transition-colors hover:border-hoverb hover:text-text"
                      >
                        Abrir
                      </button>
                      <button
                        onClick={() => void triar(r)}
                        disabled={ocupado}
                        className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
                      >
                        {nextStatusLabel(r.status)}
                      </button>
                    </div>
                  </div>

                  {aberto?.id === r.id && <Detalhe relato={aberto} />}
                </LinhaCartao>
              );
            })}
          </ul>
        )}

        {/* O purge é ação de retenção, não de operação diária — fica no rodapé,
            longe dos botões que se usam a cada triagem. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border2 pt-3">
          <p className="m-0 max-w-[62ch] text-[11.5px] leading-relaxed text-body2">
            Relatos são apagados após 90 dias. Como ainda não há job agendado, a
            limpeza é manual — rodar de tempos em tempos é o que cumpre a retenção.
          </p>
          <button
            onClick={() => void purgar()}
            disabled={ocupado}
            className="shrink-0 rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
          >
            Apagar com mais de 90 dias
          </button>
        </div>
      </Cartao>
    </div>
  );
}

/**
 * A gaveta do relato — stack, sessão, nota e **os dois e-mails**.
 *
 * Comprador e contato aparecem em linhas separadas de propósito: um vem da
 * correlação com a licença, outro foi digitado pelo usuário no relato manual, e
 * podem ser pessoas diferentes. Fundi-los faria o operador responder ao endereço
 * errado.
 */
function Detalhe({ relato }: { relato: LicErrorReportDetail }) {
  const sessao = sessionTailText(relato.sessionTail);

  return (
    <div className="mt-3 grid gap-2 border-t border-border2 pt-3">
      <p className="m-0 text-[11.5px] text-body2">
        Comprador: <span className="text-text">{relato.license.customerEmail}</span>
        {relato.license.customerName && ` (${relato.license.customerName})`} ·{' '}
        {relato.license.edition.product.name} · {relato.license.edition.slug}
      </p>

      {relato.contactEmail && (
        <p className="m-0 text-[11.5px] text-body2">
          E-mail informado no relato:{' '}
          <span className="text-text">{relato.contactEmail}</span>
        </p>
      )}

      {relato.userNote && (
        <p className="m-0 text-[12.5px] text-text">“{relato.userNote}”</p>
      )}

      {relato.stack && (
        <div>
          <p className="m-0 mb-1 text-[11px] uppercase tracking-wide text-dim">Stack</p>
          {/* Texto puro, nunca `dangerouslySetInnerHTML`: o conteúdo vem da
              máquina de outra pessoa por uma rota pública. */}
          <pre className="m-0 max-h-64 overflow-auto rounded-[9px] border border-border2 bg-panel p-2 font-mono text-[11px] leading-relaxed text-body">
            {relato.stack}
          </pre>
        </div>
      )}

      {sessao && (
        <div>
          <p className="m-0 mb-1 text-[11px] uppercase tracking-wide text-dim">
            Sessão (contém nomes de arquivos do projeto do usuário)
          </p>
          <pre className="m-0 max-h-64 overflow-auto rounded-[9px] border border-border2 bg-panel p-2 font-mono text-[11px] leading-relaxed text-body">
            {sessao}
          </pre>
        </div>
      )}
    </div>
  );
}
