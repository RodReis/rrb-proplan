import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  listWebhookEvents,
  reprocessWebhookEvent,
  type WebhookEventView,
} from '../../lib/api';
import { shortDateTime } from './licensingView';
import {
  canReprocess,
  pendingCount,
  webhookErrorText,
  webhookStatusLabel,
  webhookStatusTone,
} from './webhookOpsView';
import { Cartao, Etiqueta, LinhaCartao, TituloSecao, type Tom } from './licensingUi';

/**
 * Entregas da plataforma (SPEC-038, PR-5) — **a aba Pendências inteira**.
 *
 * ## A pergunta que esta tela responde
 *
 * *"A venda virou licença?"* — e, quando não virou, *"o que eu faço?"*.
 *
 * O PR-3 grava oferta não mapeada como `FAILED` **de propósito**: o evento tem
 * dono, o payload está guardado bruto, nada foi emitido. Sem tela, esse estado é
 * um beco — informação no banco que ninguém alcança, e a única saída seria pedir
 * à Kiwify que reenviasse.
 *
 * ## O que saiu daqui (reorganização de 2026-07-31)
 *
 * O painel carregava três blocos: entregas, o de-para `Oferta → edição` e a
 * configuração (segredo + tolerância). Os dois últimos saíram — o de-para é
 * cadastro e foi para **Produtos e Edições**, ao lado da edição que ele
 * referencia; a configuração foi para **Configurações**, com os demais ajustes.
 *
 * Pendências fica com o que o nome promete: **o que falhou e o que fazer**. Uma
 * aba que mistura "conserte isto agora" com "configure isto uma vez" obriga a
 * reler tudo para achar a urgência.
 *
 * ## Quando falta o de-para, a tela diz onde cadastrá-lo
 *
 * Separar as duas coisas custaria uma navegação a mais no conserto — a falha é
 * *aqui*, o cadastro é *lá*. Por isso o erro de oferta não mapeada aponta a aba
 * por nome: descobrir e resolver continuam ligados, sem morarem no mesmo lugar.
 */

const FILTROS: Array<{ valor: string; label: string }> = [
  { valor: 'FAILED', label: 'Falhas' },
  { valor: 'PENDING', label: 'Aguardando' },
  { valor: 'PROCESSED', label: 'Processadas' },
  { valor: '', label: 'Todas' },
];

/** Do tom da view para o vocabulário visual da área. */
const TOM: Record<'ok' | 'alert' | 'muted', Tom> = {
  ok: 'ok',
  alert: 'erro',
  muted: 'neutro',
};

export function WebhookOpsPanel() {
  // `FAILED` é o filtro inicial: é o único estado que pede ação, e abrir em
  // "todas" enterraria as falhas no histórico de entregas bem-sucedidas.
  const [filtro, setFiltro] = useState('FAILED');
  const [eventos, setEventos] = useState<WebhookEventView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  async function carregar(statusFiltro = filtro) {
    setCarregando(true);
    try {
      setEventos(await listWebhookEvents(statusFiltro || undefined));
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

  async function reprocessar(evento: WebhookEventView) {
    setOcupado(true);
    try {
      await reprocessWebhookEvent(evento.id);
      // O job é assíncrono: a entrega volta para `PENDING` e o processamento
      // acontece depois. Dizer "reprocessada" aqui afirmaria um resultado que
      // ainda não existe — e é justamente o "fechamento frágil" que este produto
      // existe para detectar.
      toast.success('Entrega reenfileirada — recarregue em instantes para ver o resultado');
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível reprocessar');
    } finally {
      setOcupado(false);
    }
  }

  const falhas = pendingCount(eventos);

  return (
    <Cartao tom={falhas > 0 ? 'erro' : 'neutro'}>
      <TituloSecao
        titulo="Entregas da plataforma"
        descricao="Cada venda que a Kiwify enviou, e se ela virou licença."
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

      {carregando ? (
        <div
          aria-hidden
          className="mt-4 h-20 animate-pulse rounded-[11px] border border-border2 bg-card"
        />
      ) : eventos.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-body">
          {filtro === 'FAILED' ? (
            <>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
              Nenhuma entrega falhou — toda venda que chegou virou licença.
            </>
          ) : (
            'Nenhuma entrega neste filtro.'
          )}
        </p>
      ) : (
        <ul className="mt-4 grid list-none gap-2 p-0">
          {eventos.map((ev) => {
            const erro = webhookErrorText(ev);
            const tom = TOM[webhookStatusTone(ev.status)];
            return (
              <LinhaCartao key={ev.id} tom={tom}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[13.5px] text-text">
                      {ev.eventType}
                      <span className="ml-1.5 font-mono text-[10.5px] text-dim">
                        {ev.platform} · {ev.externalEventId}
                      </span>
                    </p>
                    <p className="m-0 mt-0.5 text-[11.5px] text-body2">
                      recebida em {shortDateTime(ev.receivedAt)}
                      {ev.processedAt && ` · processada em ${shortDateTime(ev.processedAt)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Etiqueta tom={tom}>{webhookStatusLabel(ev.status)}</Etiqueta>
                    {canReprocess(ev) && (
                      <button
                        onClick={() => void reprocessar(ev)}
                        disabled={ocupado}
                        className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
                      >
                        Reprocessar
                      </button>
                    )}
                  </div>
                </div>

                {/* O motivo da falha é o que diz qual mapeamento cadastrar — e
                    onde cadastrá-lo, agora que o de-para mora noutra aba. */}
                {erro && (
                  <div className="m-0 mt-2 rounded-[9px] border border-error/30 bg-error/5 px-3 py-2">
                    <p className="m-0 font-mono text-[11px] leading-relaxed text-error">
                      {erro}
                    </p>
                    {erro.toLowerCase().includes('oferta') && (
                      <p className="m-0 mt-1.5 text-[11px] text-body">
                        Cadastre o par em{' '}
                        <strong className="text-text2">Produtos e Edições → Oferta →
                        edição</strong>, depois volte e reprocesse.
                      </p>
                    )}
                  </div>
                )}
              </LinhaCartao>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}
