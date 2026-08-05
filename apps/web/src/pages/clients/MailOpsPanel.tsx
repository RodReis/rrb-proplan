import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  listMailDeliveries,
  retryMailDelivery,
  type MailDeliveryOpsView,
} from '../../lib/api';
import { shortDateTime } from './licensingView';
import {
  attemptsLabel,
  failedCount,
  mailErrorText,
  mailStatusLabel,
  mailStatusTone,
  templateLabel,
} from './mailOpsView';
import { Cartao, Etiqueta, LinhaCartao, TituloSecao, type Tom } from './licensingUi';

/**
 * Entregas de e-mail (FIX #254) — a **outra metade** da aba Pendências.
 *
 * ## A pergunta que faltava resposta
 *
 * A aba mostrava só *Entregas da plataforma*: "a venda virou licença?". Mas uma
 * chave emitida cujo e-mail nunca saiu é **exatamente uma pendência** — o
 * cliente pagou e não recebeu o que comprou. Esse estado existia só dentro do
 * detalhe de uma licença específica: para achar a falha era preciso já saber
 * qual licença abrir, ou seja, já saber a resposta.
 *
 * Foi o que aconteceu em 2026-08-04 (#253): licenças emitidas, e-mails
 * enfileirados, nenhum chegou — e a tela chamada *Pendências* não tinha nada a
 * dizer sobre isso.
 *
 * ## A chave não se reenvia, e a linha diz o caminho
 *
 * `license_key` é o template que mais importa aqui e o único que **não pode**
 * ser reenfileirado: a chave em claro não é persistida (SPEC-036), então
 * reenviar mandaria uma mensagem dizendo *"esta é a sua chave"* com o campo
 * vazio. Em vez de um botão que sempre falharia — mesmo princípio do
 * `canReprocess` do webhook —, a linha mostra o motivo e aponta o **Reemitir**,
 * que gera chave nova e revoga a anterior.
 */

const FILTROS: Array<{ valor: string; label: string }> = [
  { valor: 'FAILED', label: 'Falhas' },
  { valor: 'PENDING', label: 'Aguardando' },
  { valor: 'SENT', label: 'Enviadas' },
  { valor: '', label: 'Todas' },
];

/** Do tom da view para o vocabulário visual da área. */
const TOM: Record<'ok' | 'alert' | 'muted', Tom> = {
  ok: 'ok',
  alert: 'erro',
  muted: 'neutro',
};

export function MailOpsPanel() {
  // `FAILED` primeiro pela mesma razão do painel irmão: é o único estado que
  // pede ação, e abrir em "todas" enterraria as falhas no histórico de envios
  // bem-sucedidos.
  const [filtro, setFiltro] = useState('FAILED');
  const [entregas, setEntregas] = useState<MailDeliveryOpsView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  async function carregar(statusFiltro = filtro) {
    setCarregando(true);
    try {
      setEntregas(await listMailDeliveries(statusFiltro || undefined));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar(filtro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  async function reenviar(entrega: MailDeliveryOpsView) {
    setOcupado(true);
    try {
      await retryMailDelivery(entrega.id);
      // O job é assíncrono: a entrega volta para `PENDING` e o envio acontece
      // depois. Dizer "enviada" aqui afirmaria um resultado que ainda não
      // existe — o "fechamento frágil" que este produto existe para detectar.
      toast.success('Entrega reenfileirada — recarregue em instantes para ver o resultado');
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível reenfileirar');
    } finally {
      setOcupado(false);
    }
  }

  const falhas = failedCount(entregas);

  return (
    <Cartao tom={falhas > 0 ? 'erro' : 'neutro'}>
      <TituloSecao
        titulo="Entregas de e-mail"
        descricao="Cada mensagem que saiu para o comprador, e se ela chegou a sair."
        etiqueta={
          falhas > 0 ? (
            <Etiqueta tom="erro">
              {falhas} {falhas === 1 ? 'falha' : 'falhas'}
            </Etiqueta>
          ) : undefined
        }
        acoes={
          <div
            className="flex flex-wrap gap-0.5 rounded-[10px] border border-border2 bg-panel p-0.5"
            role="group"
            aria-label="Filtrar entregas de e-mail por status"
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

      {carregando ? (
        <div
          aria-hidden
          className="mt-4 h-20 animate-pulse rounded-[11px] border border-border2 bg-card"
        />
      ) : entregas.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-body">
          {filtro === 'FAILED' ? (
            <>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
              Nenhuma entrega falhou — todo e-mail que saiu chegou ao provedor.
            </>
          ) : (
            'Nenhuma entrega neste filtro.'
          )}
        </p>
      ) : (
        <ul className="mt-4 grid list-none gap-2 p-0">
          {entregas.map((entrega) => {
            const erro = mailErrorText(entrega);
            const tom = TOM[mailStatusTone(entrega.status)];
            const tentativas = attemptsLabel(entrega.attempts);
            return (
              <LinhaCartao key={entrega.id} tom={tom}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[13.5px] text-text">
                      {templateLabel(entrega.template)}
                      <span className="ml-1.5 font-mono text-[10.5px] text-dim">
                        {entrega.to}
                      </span>
                    </p>
                    <p className="m-0 mt-0.5 text-[11.5px] text-body2">
                      criada em {shortDateTime(entrega.createdAt)}
                      {entrega.sentAt && ` · enviada em ${shortDateTime(entrega.sentAt)}`}
                      {tentativas && ` · ${tentativas}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Etiqueta tom={tom}>{mailStatusLabel(entrega.status)}</Etiqueta>
                    {/* Só na falha: reenfileirar uma entrega já enviada mandaria
                        o e-mail duas vezes ao comprador, e a que está aguardando
                        já tem job na fila — o segundo clique duplicaria. */}
                    {entrega.status === 'FAILED' && entrega.canRetry && (
                      <button
                        onClick={() => void reenviar(entrega)}
                        disabled={ocupado}
                        className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
                      >
                        Reenfileirar
                      </button>
                    )}
                  </div>
                </div>

                {erro && (
                  <p className="m-0 mt-2 rounded-[9px] border border-error/30 bg-error/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-error">
                    {erro}
                  </p>
                )}

                {/* Por que não há botão. Aparece só na falha porque é ali que
                    alguém procura a ação — numa entrega enviada, a frase seria
                    ruído sobre um problema que não existe. */}
                {entrega.status === 'FAILED' && entrega.retryBlockedReason && (
                  <p className="m-0 mt-2 rounded-[9px] border border-border2 bg-panel px-3 py-2 text-[11.5px] text-body2">
                    {entrega.retryBlockedReason}
                  </p>
                )}
              </LinhaCartao>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}
