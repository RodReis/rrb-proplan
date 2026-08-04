import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createOfferMapping,
  discardWebhookEvent,
  listWebhookEvents,
  reopenWebhookEvent,
  reprocessWebhookEvent,
  type LicCatalogResponse,
  type WebhookEventView,
} from '../../lib/api';
import { shortDateTime } from './licensingView';
import {
  canDiscard,
  canReopen,
  canReprocess,
  discardNote,
  pendingCount,
  produtoDoErro,
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
  // Ao lado de *Falhas* de propósito (SPEC-045): quem descartou vai querer
  // conferir o que tirou da lista, e o payload continua lá para consulta.
  { valor: 'DISCARDED', label: 'Descartadas' },
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

export function WebhookOpsPanel({ catalogo }: { catalogo: LicCatalogResponse }) {
  // `FAILED` é o filtro inicial: é o único estado que pede ação, e abrir em
  // "todas" enterraria as falhas no histórico de entregas bem-sucedidas.
  const [filtro, setFiltro] = useState('FAILED');
  const [eventos, setEventos] = useState<WebhookEventView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  // Qual linha está com o formulário de descarte aberto. O motivo é obrigatório,
  // então ele precisa de um campo — e um `window.prompt` não seria testável nem
  // acessível.
  const [descartando, setDescartando] = useState<string | null>(null);

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

  async function descartar(evento: WebhookEventView, motivo: string) {
    setOcupado(true);
    try {
      await discardWebhookEvent(evento.id, motivo);
      // Diz onde a linha foi parar: ela saiu do filtro atual, e sem esta frase
      // o sumiço pareceria delete — que é exatamente o que NÃO aconteceu.
      toast.success('Entrega descartada — continua consultável no filtro Descartadas');
      setDescartando(null);
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível descartar');
    } finally {
      setOcupado(false);
    }
  }

  async function reabrir(evento: WebhookEventView) {
    setOcupado(true);
    try {
      await reopenWebhookEvent(evento.id);
      // Mesmo cuidado do reprocessar: o job é assíncrono, e afirmar um desfecho
      // aqui seria o "fechamento frágil" que este produto existe para detectar.
      toast.success('Entrega reaberta — recarregue em instantes para ver o resultado');
      await carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível reabrir');
    } finally {
      setOcupado(false);
    }
  }

  const falhas = pendingCount(eventos);
  const edicoes = catalogo.products.flatMap((p) =>
    p.editions.map((e) => ({ id: e.id, label: `${p.name} · ${e.name}` })),
  );

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
                    {canDiscard(ev) && (
                      <button
                        onClick={() => setDescartando(descartando === ev.id ? null : ev.id)}
                        disabled={ocupado}
                        aria-expanded={descartando === ev.id}
                        className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-body2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
                      >
                        Descartar
                      </button>
                    )}
                    {canReopen(ev) && (
                      <button
                        onClick={() => void reabrir(ev)}
                        disabled={ocupado}
                        className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
                      >
                        Reabrir
                      </button>
                    )}
                  </div>
                </div>

                {/* O carimbo do descarte: quem, quando e por quê. Fica na linha
                    porque é o que responde "por que esta sumiu das pendências?"
                    — a pergunta de quem abre o filtro Descartadas. */}
                {discardNote(ev) && (
                  <p className="m-0 mt-2 rounded-[9px] border border-border2 bg-panel px-3 py-2 text-[11.5px] text-body2">
                    {discardNote(ev)}
                    {ev.discardedAt && ` · ${shortDateTime(ev.discardedAt)}`}
                  </p>
                )}

                {descartando === ev.id && (
                  <FormularioDescarte
                    ocupado={ocupado}
                    onCancelar={() => setDescartando(null)}
                    onConfirmar={(motivo) => void descartar(ev, motivo)}
                  />
                )}

                {/* O motivo da falha é o que diz qual mapeamento cadastrar. E
                    quando a causa é oferta sem par, **resolve aqui mesmo**: o id
                    do produto está no próprio erro, e obrigar a ir a outra aba
                    para transcrevê-lo era o beco que o dogfooding encontrou. */}
                {erro && (
                  <div className="m-0 mt-2 rounded-[9px] border border-error/30 bg-error/5 px-3 py-2">
                    <p className="m-0 font-mono text-[11px] leading-relaxed text-error">
                      {erro}
                    </p>
                    {produtoDoErro(erro) && (
                      <MapearAqui
                        produtoId={produtoDoErro(erro)!}
                        edicoes={edicoes}
                        onMapeou={() => void carregar()}
                      />
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

/**
 * Confirmação do descarte, com o motivo obrigatório (SPEC-045).
 *
 * ## Por que um campo, e não um `confirm()`
 *
 * O motivo **é** a confirmação. Descartar sem motivo produz o mesmo item
 * ilegível que a lista de pendências já produzia, só que escondido — então o
 * servidor recusa com `422`, e um `window.confirm` não teria onde escrevê-lo.
 *
 * O botão nasce desabilitado e só liga com texto não-vazio: é o que impede o
 * clique reflexo, sem precisar de um segundo diálogo por cima.
 */
function FormularioDescarte({
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const valido = motivo.trim().length > 0;

  return (
    <div className="mt-2 rounded-[9px] border border-border2 bg-panel px-3 py-2.5">
      <p className="m-0 text-[11.5px] text-body2">
        A entrega sai das pendências, mas <strong className="text-text2">a linha e o
        payload continuam</strong> — consultáveis no filtro Descartadas.
      </p>
      <div className="mt-2 grid gap-2 min-[720px]:grid-cols-[1fr_auto_auto]">
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="por que esta entrega não vai virar nada?"
          aria-label="Motivo do descarte"
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[12px] text-text transition-colors focus:border-accentBorder"
        />
        <button
          onClick={() => onConfirmar(motivo.trim())}
          disabled={!valido || ocupado}
          className="rounded-[9px] bg-btnbg px-4 py-2 text-[12px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Confirmar descarte
        </button>
        <button
          onClick={onCancelar}
          disabled={ocupado}
          className="rounded-[9px] border border-border2 px-3 py-2 text-[12px] text-body2 transition-colors hover:text-text disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * Resolve a oferta sem par **na própria linha que falhou**.
 *
 * O id do produto já está no erro; o que falta é dizer qual edição a venda
 * entrega. Obrigar a ir a outra aba para transcrever um uuid à mão era o beco
 * que o dogfooding encontrou (2026-07-31).
 *
 * O mapeamento nasce **curinga** (`externalOfferId: null`): a Kiwify não manda
 * oferta, então o par que resolve esta venda é o do produto inteiro. Quem
 * precisar de granularidade por oferta cadastra em Produtos e Edições.
 */
function MapearAqui({
  produtoId,
  edicoes,
  onMapeou,
}: {
  produtoId: string;
  edicoes: Array<{ id: string; label: string }>;
  onMapeou: () => void;
}) {
  const [edicaoId, setEdicaoId] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function mapear() {
    setOcupado(true);
    try {
      await createOfferMapping({
        externalProductId: produtoId,
        externalOfferId: null,
        editionId: edicaoId,
      });
      // Diz o próximo passo: o mapeamento sozinho não emite a licença — a
      // entrega precisa ser reprocessada, e o botão está logo acima.
      toast.success('Mapeamento criado — agora reprocesse esta entrega');
      onMapeou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível mapear');
    } finally {
      setOcupado(false);
    }
  }

  if (edicoes.length === 0) {
    return (
      <p className="m-0 mt-1.5 text-[11px] text-body">
        Cadastre uma edição em{' '}
        <strong className="text-text2">Produtos e Edições</strong> para poder
        ligar esta venda.
      </p>
    );
  }

  return (
    <div className="mt-2 grid gap-2 min-[720px]:grid-cols-[1fr_auto]">
      <select
        value={edicaoId}
        onChange={(e) => setEdicaoId(e.target.value)}
        aria-label={`Edição para o produto ${produtoId}`}
        disabled={ocupado}
        className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[12px] text-text transition-colors focus:border-accentBorder [color-scheme:dark_light]"
      >
        <option value="">ligar este produto a uma edição…</option>
        {edicoes.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => void mapear()}
        disabled={!edicaoId || ocupado}
        className="rounded-[9px] bg-btnbg px-4 py-2 text-[12px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
      >
        Mapear
      </button>
    </div>
  );
}
