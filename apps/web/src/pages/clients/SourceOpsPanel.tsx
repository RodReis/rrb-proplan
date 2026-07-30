import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getSourceSettings,
  listSourcePending,
  reinviteSource,
  removeSourceAccess,
  setLicenseGithubUsername,
  setSourcePat,
  testSourceConnection,
  type SourcePendingItem,
  type SourceSettingsView,
} from '../../lib/api';
import { shortDateTime } from './licensingView';
import {
  actionableCount,
  canReinvite,
  canRemoveAccess,
  nextActionText,
  patStatusText,
  reasonLabel,
  reasonTone,
  reconcileSummary,
  removalOutcomeText,
} from './sourceOpsView';

/**
 * Acesso ao repo source (SPEC-039 PR-5) — a **tela mínima** da Fatia 28.
 *
 * ## A pergunta que esta tela responde
 *
 * *"Quem comprou o código-fonte já está no repositório?"* — e, quando não está,
 * *"o que eu faço?"*.
 *
 * Os PRs 3 e 4 gravam três estados que **pedem gente** e não se resolvem sozinhos:
 * `PENDING` sem username (o comprador não respondeu ao e-mail), `INVITED` parado
 * (não aceitou o convite) e `FAILED` (o GitHub recusou). Sem esta tela, os três
 * são informação no banco que ninguém alcança — e aqui o beco é caro: a edição com
 * código-fonte é a mais cara do catálogo, e "comprou e não recebeu" vira ticket com
 * o cliente já pago.
 *
 * ## O que esta tela NÃO diz, e é regra da spec
 *
 * **Remover o colaborador não recupera o que já foi clonado.** O §Objetivo é
 * explícito: *"painel que sugira 'acesso revogado = código recuperado' mente para
 * o operador"*. O que a remoção entrega é o fim dos *updates* — o mecanismo real do
 * produto é contratual (§8 do MVP4). Por isso a confirmação de remoção nomeia a
 * chamada feita e diz, com estas palavras, que o clone permanece.
 *
 * ## O PAT não aparece, e "configurado" não é "funciona"
 *
 * Write-only, como o segredo do webhook. Mas com uma diferença que muda o
 * desenho: **PAT fine-grained expira** (limite do GitHub). Uma expiração
 * silenciosa pararia os convites sem erro visível, então a tela nunca afirma "está
 * tudo bem" — ela aponta para o teste de conexão, que é a metade que antecipa.
 *
 * ## O painel completo é a SPEC-040
 *
 * Aqui é o mínimo que destrava a operação (§Fora de escopo). Métricas e histórico
 * por cliente são a Fatia 29, que absorve estas telas mínimas.
 */

/** Os mesmos pares de tom das outras telas de licenciamento. */
const TOM: Record<'ok' | 'alert' | 'muted', string> = {
  ok: 'border-accentBorder text-text2',
  alert: 'border-danger text-danger',
  muted: 'border-border2 text-body2',
};

export function SourceOpsPanel() {
  const [itens, setItens] = useState<SourcePendingItem[]>([]);
  const [settings, setSettings] = useState<SourceSettingsView | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      const [pendentes, cfg] = await Promise.all([listSourcePending(), getSourceSettings()]);
      setItens(pendentes);
      setSettings(cfg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  return (
    <div className="grid gap-4">
      <PendenciasBloco
        itens={itens}
        carregando={carregando}
        onMudou={() => void carregar()}
      />
      <PatBloco settings={settings} onMudou={() => void carregar()} />
    </div>
  );
}

function PendenciasBloco({
  itens,
  carregando,
  onMudou,
}: {
  itens: SourcePendingItem[];
  carregando: boolean;
  onMudou: () => void;
}) {
  const acionaveis = actionableCount(itens);

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold text-text">
          Acesso ao código-fonte
          {/* O número que justifica a tela. Só conta o que pede ação NOSSA. */}
          {acionaveis > 0 && (
            <span className="ml-2 rounded-full border border-danger px-2 py-px font-mono text-[10px] font-normal text-danger">
              {acionaveis} {acionaveis === 1 ? 'pendência' : 'pendências'}
            </span>
          )}
        </h2>
      </div>
      <p className="m-0 mt-1 text-[11.5px] text-body2">
        Quem comprou a edição com código-fonte e ainda não está no repositório.
      </p>

      {carregando ? (
        <p className="mt-3 text-[12.5px] text-body">Carregando…</p>
      ) : itens.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-body">
          Nenhuma pendência — todo comprador com direito ao código-fonte já foi
          convidado.
        </p>
      ) : (
        <ul className="mt-3 grid list-none gap-2 p-0">
          {itens.map((item) => (
            <PendenciaItem key={item.licenseId} item={item} onMudou={onMudou} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PendenciaItem({
  item,
  onMudou,
}: {
  item: SourcePendingItem;
  onMudou: () => void;
}) {
  const [username, setUsername] = useState(item.githubUsername ?? '');
  const [ocupado, setOcupado] = useState(false);

  async function salvarUsername() {
    setOcupado(true);
    try {
      const r = await setLicenseGithubUsername(item.licenseId, username.trim());
      // A distinção importa: "gravei" e "gravei e cancelei o convite errado" são
      // desfechos diferentes, e o segundo significa que alguém perdeu acesso agora.
      toast.success(
        r.previousInviteCanceled
          ? `Username trocado para ${r.username} — o acesso anterior foi removido e o convite será reemitido`
          : `Username ${r.username} gravado — o convite sai na próxima rodada`,
      );
      onMudou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  async function reemitir() {
    setOcupado(true);
    try {
      // A resposta fala da rodada inteira, não desta licença: reemitir dispara a
      // reconciliação do tenant, e prometer "convite reemitido" esconderia isso.
      toast.success(reconcileSummary(await reinviteSource(item.licenseId)));
      onMudou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível reemitir');
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    setOcupado(true);
    try {
      const { outcome } = await removeSourceAccess(item.licenseId);
      // `failed` é sucesso HTTP com fracasso real: o acesso continua de pé. Dizer
      // "removido" aqui seria o fechamento frágil que este produto existe para
      // detectar.
      const texto = removalOutcomeText(outcome);
      if (outcome === 'failed') toast.error(texto);
      else toast.success(texto);
      onMudou();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível remover');
    } finally {
      setOcupado(false);
    }
  }

  const tom = reasonTone(item.reason);

  return (
    <li className="rounded-[11px] border border-border2 bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 truncate text-[13.5px] text-text">
            {item.customerName ?? item.customerEmail}
            <span className="ml-1.5 font-mono text-[10.5px] text-dim">
              {item.editionName}
            </span>
          </p>
          <p className="m-0 mt-0.5 text-[11.5px] text-body2">
            {item.customerEmail}
            {item.sourceInviteAt && ` · previsto para ${shortDateTime(item.sourceInviteAt)}`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-px font-mono text-[10px] ${TOM[tom]}`}>
          {reasonLabel(item.reason)}
        </span>
      </div>

      {/* O "e agora?" — cada motivo tem uma ação diferente, e sem isto o operador
          olha um enum e adivinha. */}
      <p className="m-0 mt-1.5 text-[11.5px] text-body">{nextActionText(item)}</p>

      {/* O motivo da falha é o que diz o que consertar antes de reemitir. */}
      {item.sourceAccessError && (
        <p className="m-0 mt-1 text-[11.5px] text-danger">{item.sourceAccessError}</p>
      )}

      <div className="mt-2 grid gap-2 min-[720px]:grid-cols-[1fr_auto_auto_auto]">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username do GitHub"
          aria-label={`Username do GitHub de ${item.customerEmail}`}
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
        />
        <button
          onClick={salvarUsername}
          disabled={ocupado || !username.trim() || username.trim() === item.githubUsername}
          className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Salvar username
        </button>
        {/* Só onde reemitir de fato faz algo — botão que não faz nada é pior que a
            ausência dele. */}
        {canReinvite(item) && (
          <button
            onClick={reemitir}
            disabled={ocupado}
            className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-text2 disabled:opacity-50"
          >
            Reemitir convite
          </button>
        )}
        {/* Só onde existe acesso — oferecer isto sem convite emitido sugeriria que
            há algo a revogar. */}
        {canRemoveAccess(item) && (
          <button
            onClick={remover}
            disabled={ocupado}
            className="rounded-[9px] border border-danger px-3 py-2 text-[12.5px] text-danger disabled:opacity-50"
          >
            Remover acesso
          </button>
        )}
      </div>
    </li>
  );
}

function PatBloco({
  settings,
  onMudou,
}: {
  settings: SourceSettingsView | null;
  onMudou: () => void;
}) {
  const [pat, setPat] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState<string | null>(null);

  async function salvar() {
    setOcupado(true);
    try {
      await setSourcePat(pat);
      setPat('');
      setTeste(null);
      onMudou();
      toast.success('PAT salvo — rode o teste de conexão para confirmar o escopo');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    try {
      const r = await testSourceConnection();
      // `ok: false` **não** é erro de rede nem bug: é o resultado do teste. Tratá-lo
      // como exceção diria "o ProPlan quebrou" sobre um token expirado.
      if (r.ok) {
        setTeste(`Conexão OK — o PAT administra ${r.repo}.`);
        toast.success('Conexão OK');
      } else {
        setTeste(`Falhou: ${r.reason}`);
        toast.error(`Teste falhou: ${r.reason}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível testar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <h2 className="m-0 text-[15px] font-semibold text-text">
        Token do GitHub (código-fonte)
      </h2>
      {/* Descreve o EFEITO, não o booleano: "configurado" não significa "funciona",
          porque PAT fine-grained expira. */}
      <p className="m-0 mt-1 text-[11.5px] text-body">
        {settings ? patStatusText(settings.githubPatSet, settings.sourceRepo) : '—'}
      </p>
      <p className="m-0 mt-1 text-[11.5px] text-body2">
        PAT <strong>fine-grained</strong>, com permissão de administração{' '}
        <strong>somente no repositório do produto</strong> — não use um token
        clássico de escopo amplo.
      </p>

      <div className="mt-2 grid gap-2 min-[720px]:grid-cols-[1fr_auto_auto]">
        <input
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="github_pat_…"
          aria-label="PAT do GitHub"
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
        />
        <button
          onClick={salvar}
          disabled={ocupado || !pat.trim()}
          className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Salvar PAT
        </button>
        <button
          onClick={testar}
          disabled={ocupado || !settings?.githubPatSet}
          className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-text2 disabled:opacity-50"
        >
          Testar conexão
        </button>
      </div>

      {teste && <p className="m-0 mt-2 text-[11.5px] text-body">{teste}</p>}
    </section>
  );
}
