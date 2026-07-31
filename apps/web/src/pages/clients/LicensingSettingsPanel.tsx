import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getLicensingSettings,
  getSourceSettings,
  setSourcePat,
  testSourceConnection,
  updateLicensingSettings,
  type LicSettingsView,
  type SourceSettingsView,
} from '../../lib/api';
import { toleranceLabel } from './webhookOpsView';
import { patStatusText } from './sourceOpsView';
import { Cartao, Etiqueta, TituloSecao } from './licensingUi';

/**
 * Configurações do licenciamento — **tudo que se configura, num lugar só**
 * (decisão do PI, 2026-07-31).
 *
 * ## Por que reunir
 *
 * Os três ajustes desta área estavam espalhados por duas abas: segredo do
 * webhook e tolerância de inadimplência ficavam no fim de Pendências, colados na
 * operação; o PAT do GitHub ficava no fim do painel de código-fonte. Quem
 * chegava para *configurar* tinha de saber de antemão em qual tela de *operação*
 * cada campo se escondia.
 *
 * O argumento antigo — *"os painéis trazem a configuração junto da operação para
 * não obrigar a ir e voltar entre abas"* — não se sustentou no uso: configurar é
 * tarefa de uma vez na vida do workspace, e operar é diário. Otimizar o layout
 * diário para o caso raro custava um campo perdido no rodapé de outra tela.
 *
 * ## O que cada um quebra quando falta
 *
 * Os três blocos abrem dizendo o **efeito da ausência**, não o estado do
 * booleano. "Não configurado" não informa nada; "toda entrega responde 401 até
 * você salvar" diz o que está acontecendo agora com as vendas.
 */
export function LicensingSettingsPanel() {
  const [licSettings, setLicSettings] = useState<LicSettingsView | null>(null);
  const [sourceSettings, setSourceSettings] = useState<SourceSettingsView | null>(null);

  async function carregar() {
    try {
      const [lic, src] = await Promise.all([getLicensingSettings(), getSourceSettings()]);
      setLicSettings(lic);
      setSourceSettings(src);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível carregar');
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  return (
    <div className="grid gap-4">
      <SegredoBloco settings={licSettings} onMudou={() => void carregar()} />
      <ToleranciaBloco settings={licSettings} onMudou={() => void carregar()} />
      <PatBloco settings={sourceSettings} onMudou={() => void carregar()} />
    </div>
  );
}

/**
 * O segredo do webhook.
 *
 * **Write-only.** A tela mostra *se* há segredo, nunca o valor: ele é o Token que
 * a **Kiwify** gera, então a origem é o painel dela — ninguém precisa lê-lo de
 * volta aqui, e exibi-lo seria superfície de vazamento sem nada em troca.
 */
function SegredoBloco({
  settings,
  onMudou,
}: {
  settings: LicSettingsView | null;
  onMudou: () => void;
}) {
  const [segredo, setSegredo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const configurado = settings?.webhookSecretSet ?? false;

  async function salvar() {
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

  return (
    <Cartao tom={settings && !configurado ? 'erro' : 'neutro'}>
      <TituloSecao
        titulo="Segredo do webhook"
        descricao="O Token gerado pela Kiwify. É ele que autentica cada venda que chega."
        etiqueta={
          settings ? (
            <Etiqueta tom={configurado ? 'ok' : 'erro'}>
              {configurado ? 'configurado' : 'ausente'}
            </Etiqueta>
          ) : undefined
        }
      />

      <p className="m-0 mt-3 text-[12px] leading-relaxed text-body">
        {configurado ? (
          <>
            O valor <strong className="text-text2">não é exibido</strong> — pegue-o no
            painel da Kiwify se precisar conferir.
          </>
        ) : (
          <>
            <strong className="text-error">Toda entrega da plataforma responde 401</strong>{' '}
            até você salvar o Token da Kiwify aqui. Nenhuma venda vira licença
            enquanto isso.
          </>
        )}
      </p>

      <div className="mt-3 grid gap-2 min-[720px]:grid-cols-[1fr_auto]">
        <input
          type="password"
          value={segredo}
          onChange={(e) => setSegredo(e.target.value)}
          placeholder="Token gerado pela Kiwify"
          aria-label="Segredo do webhook"
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text transition-colors focus:border-accentBorder"
        />
        <button
          onClick={salvar}
          disabled={ocupado || !segredo.trim()}
          className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Salvar segredo
        </button>
      </div>
    </Cartao>
  );
}

/**
 * Tolerância de inadimplência.
 *
 * A frase descreve o **efeito**, não o número: `null` não é campo vazio, é "o
 * ProPlan nunca corta". Um `—` levaria alguém a "consertar".
 */
function ToleranciaBloco({
  settings,
  onMudou,
}: {
  settings: LicSettingsView | null;
  onMudou: () => void;
}) {
  const [dias, setDias] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const desligado = settings?.pastDueToleranceDays === null;

  async function salvar(valor: number | null) {
    setOcupado(true);
    try {
      await updateLicensingSettings({ pastDueToleranceDays: valor });
      setDias('');
      onMudou();
      toast.success(valor === null ? 'Corte por atraso desligado' : 'Tolerância atualizada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao>
      <TituloSecao
        titulo="Tolerância de inadimplência"
        descricao="Quantos dias depois do aviso de atraso o acesso é cortado."
        etiqueta={
          settings ? (
            <Etiqueta tom={desligado ? 'neutro' : 'info'}>
              {desligado ? 'corte desligado' : `${settings.pastDueToleranceDays} dias`}
            </Etiqueta>
          ) : undefined
        }
      />

      <p className="m-0 mt-3 text-[12px] leading-relaxed text-body">
        {settings ? toleranceLabel(settings.pastDueToleranceDays) : '—'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          max={3650}
          value={dias}
          onChange={(e) => setDias(e.target.value)}
          placeholder="dias"
          aria-label="Dias de tolerância"
          disabled={ocupado}
          className="w-28 rounded-[9px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text transition-colors focus:border-accentBorder"
        />
        <button
          onClick={() => salvar(Number(dias))}
          disabled={ocupado || dias.trim() === '' || Number.isNaN(Number(dias))}
          className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          Salvar dias
        </button>
        {/* A mitigação sem deploy do risco aceito (decisão PI #3). Fica na tela
            porque é a saída de quem detectar corte indevido no piloto. */}
        {!desligado && (
          <button
            onClick={() => salvar(null)}
            disabled={ocupado}
            className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-body2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
          >
            Desligar o corte por atraso
          </button>
        )}
      </div>
    </Cartao>
  );
}

/**
 * O PAT do GitHub.
 *
 * Write-only como o segredo do webhook, mas com uma diferença que muda o
 * desenho: **PAT fine-grained expira** (limite do GitHub). Uma expiração
 * silenciosa pararia os convites sem erro visível, então a tela nunca afirma
 * "está tudo bem" — ela aponta para o teste de conexão, que é a metade que
 * antecipa.
 */
function PatBloco({
  settings,
  onMudou,
}: {
  settings: SourceSettingsView | null;
  onMudou: () => void;
}) {
  const [pat, setPat] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);

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
        setTeste({ ok: true, texto: `Conexão OK — o PAT administra ${r.repo}.` });
        toast.success('Conexão OK');
        // **Recarrega as settings — FIX #214.** O repositório é salvo no bloco de
        // produtos, que recarrega o catálogo; este painel não ficava sabendo, e a
        // frase acima continuava dizendo "nenhum produto tem repositório
        // configurado" **ao lado** de um teste que acabara de administrar aquele
        // repositório. Das duas afirmações contraditórias, a assustadora era a
        // falsa — e é assim que uma tela ensina a ser ignorada.
        onMudou();
      } else {
        setTeste({ ok: false, texto: `Falhou: ${r.reason}` });
        toast.error(`Teste falhou: ${r.reason}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível testar');
    } finally {
      setOcupado(false);
    }
  }

  const configurado = settings?.githubPatSet ?? false;

  return (
    <Cartao>
      <TituloSecao
        titulo="Token do GitHub"
        descricao="Usado só para convidar e remover compradores do repositório de código-fonte."
        etiqueta={
          settings ? (
            <Etiqueta tom={configurado ? 'ok' : 'neutro'}>
              {configurado ? 'salvo' : 'ausente'}
            </Etiqueta>
          ) : undefined
        }
      />

      {/* Descreve o EFEITO, não o booleano: "configurado" não significa "funciona",
          porque PAT fine-grained expira. */}
      <p className="m-0 mt-3 text-[12px] leading-relaxed text-body">
        {settings ? patStatusText(settings.githubPatSet, settings.sourceRepo) : '—'}
      </p>
      <p className="m-0 mt-2 text-[11.5px] leading-relaxed text-body2">
        PAT <strong className="text-text2">fine-grained</strong>, com permissão de
        administração <strong className="text-text2">somente no repositório do
        produto</strong> — não use um token clássico de escopo amplo.
      </p>

      <div className="mt-3 grid gap-2 min-[720px]:grid-cols-[1fr_auto_auto]">
        <input
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="github_pat_…"
          aria-label="PAT do GitHub"
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12.5px] text-text transition-colors focus:border-accentBorder"
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
          disabled={ocupado || !configurado}
          className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
        >
          Testar conexão
        </button>
      </div>

      {teste && (
        <p
          className={
            'm-0 mt-3 rounded-[9px] border px-3 py-2 text-[11.5px] leading-relaxed ' +
            (teste.ok
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-error/45 bg-error/10 text-error')
          }
        >
          {teste.texto}
        </p>
      )}
    </Cartao>
  );
}
