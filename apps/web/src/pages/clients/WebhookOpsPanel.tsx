import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createOfferMapping,
  deleteOfferMapping,
  getLicensingSettings,
  listOfferMappings,
  listWebhookEvents,
  reprocessWebhookEvent,
  updateLicensingSettings,
  type LicCatalogResponse,
  type LicSettingsView,
  type OfferMappingView,
  type WebhookEventView,
} from '../../lib/api';
import { shortDateTime } from './licensingView';
import {
  canReprocess,
  offerLabel,
  pendingCount,
  toleranceLabel,
  webhookErrorText,
  webhookStatusLabel,
  webhookStatusTone,
} from './webhookOpsView';

/**
 * Operação do webhook (SPEC-038, PR-5) — a **tela mínima** da Fatia 27.
 *
 * ## A pergunta que esta tela responde
 *
 * *"A venda virou licença?"* — e, quando não virou, *"o que eu faço?"*.
 *
 * O PR-3 grava oferta não mapeada como `FAILED` **de propósito**: o evento tem
 * dono, o payload está guardado bruto, nada foi emitido. Sem tela, esse estado é
 * um beco — informação no banco que ninguém alcança, e a única saída seria pedir
 * à Kiwify que reenviasse. O critério de aceite da fatia é sair dele: *"cadastrar
 * o mapeamento e reprocessar o evento pendente emite a licença"*.
 *
 * Daí a ordem dos três blocos, que é a ordem do conserto: **o que falhou** →
 * **o de-para que resolve** → **a configuração**.
 *
 * ## O segredo não aparece
 *
 * A tela mostra *se* há segredo, nunca o valor. Ele é o Token que a **Kiwify**
 * gera (achado do PR-3), então a origem é o painel dela — ninguém precisa lê-lo
 * de volta aqui, e exibi-lo seria superfície de vazamento sem nada em troca.
 *
 * ## O painel completo é a SPEC-040
 *
 * Aqui é o mínimo que destrava a operação. Busca, métricas e histórico por
 * cliente são a Fatia 29, que absorve estas telas mínimas.
 */

const FILTROS: Array<{ valor: string; label: string }> = [
  { valor: 'FAILED', label: 'Falhas' },
  { valor: 'PENDING', label: 'Aguardando' },
  { valor: 'PROCESSED', label: 'Processadas' },
  { valor: '', label: 'Todas' },
];

/**
 * Classe do badge por tom — os mesmos pares que a lista de licenças usa, para
 * que "ok" e "alerta" signifiquem a mesma coisa nas duas telas.
 */
const TOM: Record<'ok' | 'alert' | 'muted', string> = {
  ok: 'border-accentBorder text-text2',
  alert: 'border-danger text-danger',
  muted: 'border-border2 text-body2',
};

export function WebhookOpsPanel({ catalogo }: { catalogo: LicCatalogResponse }) {
  // `FAILED` é o filtro inicial: é o único estado que pede ação, e abrir em
  // "todas" enterraria as falhas no histórico de entregas bem-sucedidas.
  const [filtro, setFiltro] = useState('FAILED');
  const [eventos, setEventos] = useState<WebhookEventView[]>([]);
  const [mapeamentos, setMapeamentos] = useState<OfferMappingView[]>([]);
  const [settings, setSettings] = useState<LicSettingsView | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  async function carregar(statusFiltro = filtro) {
    setCarregando(true);
    try {
      const [evs, maps, cfg] = await Promise.all([
        listWebhookEvents(statusFiltro || undefined),
        listOfferMappings(),
        getLicensingSettings(),
      ]);
      setEventos(evs);
      setMapeamentos(maps);
      setSettings(cfg);
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
    <div className="grid gap-4">
      <EntregasBloco
        eventos={eventos}
        falhas={falhas}
        filtro={filtro}
        carregando={carregando}
        ocupado={ocupado}
        onFiltro={setFiltro}
        onReprocessar={reprocessar}
      />
      <MapeamentosBloco
        catalogo={catalogo}
        mapeamentos={mapeamentos}
        onMudou={() => void carregar()}
      />
      <SettingsBloco settings={settings} onMudou={() => void carregar()} />
    </div>
  );
}

function EntregasBloco({
  eventos,
  falhas,
  filtro,
  carregando,
  ocupado,
  onFiltro,
  onReprocessar,
}: {
  eventos: WebhookEventView[];
  falhas: number;
  filtro: string;
  carregando: boolean;
  ocupado: boolean;
  onFiltro: (v: string) => void;
  onReprocessar: (e: WebhookEventView) => void;
}) {
  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold text-text">
          Entregas da plataforma
          {/* O número que justifica a tela. Só aparece quando há o que fazer. */}
          {falhas > 0 && (
            <span className="ml-2 rounded-full border border-danger px-2 py-px font-mono text-[10px] font-normal text-danger">
              {falhas} {falhas === 1 ? 'falha' : 'falhas'}
            </span>
          )}
        </h2>
        <div className="flex gap-1.5" role="group" aria-label="Filtrar por status">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              onClick={() => onFiltro(f.valor)}
              aria-pressed={filtro === f.valor}
              className={`rounded-[9px] border px-2.5 py-1 text-[11.5px] ${
                filtro === f.valor
                  ? 'border-accentBorder text-text'
                  : 'border-border2 text-body2'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {carregando ? (
        <p className="mt-3 text-[12.5px] text-body">Carregando…</p>
      ) : eventos.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-body">
          {filtro === 'FAILED'
            ? 'Nenhuma entrega falhou — toda venda que chegou virou licença.'
            : 'Nenhuma entrega neste filtro.'}
        </p>
      ) : (
        <ul className="mt-3 grid list-none gap-2 p-0">
          {eventos.map((ev) => {
            const erro = webhookErrorText(ev);
            const tom = webhookStatusTone(ev.status);
            return (
              <li
                key={ev.id}
                className="rounded-[11px] border border-border2 bg-card px-4 py-3"
              >
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
                    <span
                      className={`rounded-full border px-2 py-px font-mono text-[10px] ${TOM[tom]}`}
                    >
                      {webhookStatusLabel(ev.status)}
                    </span>
                    {canReprocess(ev) && (
                      <button
                        onClick={() => onReprocessar(ev)}
                        disabled={ocupado}
                        className="rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-text2 disabled:opacity-50"
                      >
                        Reprocessar
                      </button>
                    )}
                  </div>
                </div>
                {/* O motivo da falha é o que diz qual mapeamento cadastrar. */}
                {erro && <p className="m-0 mt-1.5 text-[11.5px] text-danger">{erro}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MapeamentosBloco({
  catalogo,
  mapeamentos,
  onMudou,
}: {
  catalogo: LicCatalogResponse;
  mapeamentos: OfferMappingView[];
  onMudou: () => void;
}) {
  const [produtoId, setProdutoId] = useState('');
  const [ofertaId, setOfertaId] = useState('');
  const [edicaoId, setEdicaoId] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const edicoes = catalogo.products.flatMap((p) =>
    p.editions.map((e) => ({ id: e.id, label: `${p.name} · ${e.name}` })),
  );

  async function criar() {
    setOcupado(true);
    try {
      await createOfferMapping({
        externalProductId: produtoId,
        // Vazio = curinga. `null` explícito, não string vazia: é o que faz
        // "qualquer oferta deste produto" resolver.
        externalOfferId: ofertaId.trim() || null,
        editionId: edicaoId,
      });
      setProdutoId('');
      setOfertaId('');
      onMudou();
      toast.success('Mapeamento criado — reprocesse a entrega que falhou');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível criar');
    } finally {
      setOcupado(false);
    }
  }

  async function remover(id: string) {
    setOcupado(true);
    try {
      await deleteOfferMapping(id);
      onMudou();
      toast.success('Mapeamento removido');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível remover');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <h2 className="m-0 text-[15px] font-semibold text-text">Oferta → edição</h2>
      <p className="m-0 mt-1 text-[11.5px] text-body2">
        O de-para que resolve a compra em edição. Sem ele, a venda chega e falha
        como “oferta não mapeada”.
      </p>

      <ul className="mt-3 grid list-none gap-2 p-0">
        {mapeamentos.length === 0 && (
          <li className="text-[12.5px] text-body">Nenhum mapeamento ainda.</li>
        )}
        {mapeamentos.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-border2 bg-card px-4 py-3"
          >
            <div className="min-w-0">
              <p className="m-0 truncate text-[13.5px] text-text">
                {m.edition.name}
                <span className="ml-1.5 font-mono text-[10.5px] text-dim">
                  {m.edition.slug}
                </span>
              </p>
              <p className="m-0 mt-0.5 font-mono text-[10.5px] text-dim">
                produto {m.externalProductId} · {offerLabel(m)}
              </p>
            </div>
            <button
              onClick={() => remover(m.id)}
              disabled={ocupado}
              className="shrink-0 rounded-[9px] border border-border2 px-2.5 py-1 text-[11.5px] text-body2 disabled:opacity-50"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>

      <fieldset disabled={ocupado} className="mt-4 grid gap-2 border-0 p-0">
        <legend className="text-[12px] text-body2">Novo mapeamento</legend>
        <div className="grid gap-2 min-[720px]:grid-cols-4">
          <input
            value={produtoId}
            onChange={(e) => setProdutoId(e.target.value)}
            placeholder="id do produto na plataforma"
            aria-label="Id do produto na plataforma"
            className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
          />
          <input
            value={ofertaId}
            onChange={(e) => setOfertaId(e.target.value)}
            placeholder="id da oferta (vazio = qualquer)"
            aria-label="Id da oferta na plataforma"
            className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
          />
          <select
            value={edicaoId}
            onChange={(e) => setEdicaoId(e.target.value)}
            aria-label="Edição"
            // `color-scheme` é o que torna a lista aberta legível no tema
            // escuro — sem ela o popup é desenhado pelo sistema em tema claro
            // (achado do dogfooding da SPEC-031, #153).
            className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text [color-scheme:dark_light]"
          >
            <option value="">edição…</option>
            {edicoes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <button
            onClick={criar}
            disabled={!produtoId.trim() || !edicaoId}
            className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
          >
            Cadastrar
          </button>
        </div>
      </fieldset>
    </section>
  );
}

function SettingsBloco({
  settings,
  onMudou,
}: {
  settings: LicSettingsView | null;
  onMudou: () => void;
}) {
  const [segredo, setSegredo] = useState('');
  const [dias, setDias] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function salvarSegredo() {
    setOcupado(true);
    try {
      await updateLicensingSettings({ webhookSecret: segredo });
      setSegredo('');
      onMudou();
      toast.success('Segredo do webhook atualizado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  async function salvarTolerancia(valor: number | null) {
    setOcupado(true);
    try {
      await updateLicensingSettings({ pastDueToleranceDays: valor });
      setDias('');
      onMudou();
      toast.success(
        valor === null ? 'Corte por atraso desligado' : 'Tolerância atualizada',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <h2 className="m-0 text-[15px] font-semibold text-text">Configuração</h2>

      <div className="mt-3 grid gap-4">
        <div>
          <p className="m-0 mb-1.5 text-[11.5px] font-semibold text-text2">
            Segredo do webhook
          </p>
          <p className="m-0 text-[11.5px] text-body2">
            {settings?.webhookSecretSet
              ? 'Configurado. O valor não é exibido — pegue-o no painel da Kiwify se precisar conferir.'
              : 'Não configurado: toda entrega da plataforma responde 401 até você salvar o Token da Kiwify aqui.'}
          </p>
          <div className="mt-2 grid gap-2 min-[720px]:grid-cols-[1fr_auto]">
            <input
              type="password"
              value={segredo}
              onChange={(e) => setSegredo(e.target.value)}
              placeholder="Token gerado pela Kiwify"
              aria-label="Segredo do webhook"
              disabled={ocupado}
              className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
            />
            <button
              onClick={salvarSegredo}
              disabled={ocupado || !segredo.trim()}
              className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
            >
              Salvar segredo
            </button>
          </div>
        </div>

        <div>
          <p className="m-0 mb-1.5 text-[11.5px] font-semibold text-text2">
            Tolerância de inadimplência
          </p>
          {/* A frase descreve o EFEITO, não o número: `null` não é campo vazio,
              é "o ProPlan nunca corta". Um `—` levaria alguém a "consertar". */}
          <p className="m-0 text-[11.5px] text-body">
            {settings ? toleranceLabel(settings.pastDueToleranceDays) : '—'}
          </p>
          <div className="mt-2 grid gap-2 min-[720px]:grid-cols-[auto_auto_1fr]">
            <input
              type="number"
              min={0}
              max={3650}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              placeholder="dias"
              aria-label="Dias de tolerância"
              disabled={ocupado}
              className="w-28 rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
            />
            <button
              onClick={() => salvarTolerancia(Number(dias))}
              disabled={ocupado || dias.trim() === '' || Number.isNaN(Number(dias))}
              className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
            >
              Salvar dias
            </button>
            {/* A mitigação sem deploy do risco aceito (decisão PI #3). Fica na
                tela porque é a saída de quem detectar corte indevido no piloto. */}
            {settings?.pastDueToleranceDays !== null && (
              <button
                onClick={() => salvarTolerancia(null)}
                disabled={ocupado}
                className="justify-self-start rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-body2 disabled:opacity-50"
              >
                Desligar o corte por atraso
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
