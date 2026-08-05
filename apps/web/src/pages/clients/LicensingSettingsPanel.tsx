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
      <KiwifyApiBloco settings={licSettings} onMudou={() => void carregar()} />
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

/**
 * As credenciais da API pública da Kiwify (SPEC-047).
 *
 * ## Por que este bloco existe, e por que ele quase não existiu
 *
 * A SPEC-047 saiu em três PRs — schema, backend e o bloco 3 na aba — e **nenhum
 * deles criou o formulário**. As colunas nasceram, a rota `PUT /settings` já as
 * aceitava, e ainda assim não havia caminho pela interface: exatamente o padrão
 * que já produziu três achados nesta área (`sourceRepo`, `githubPat`,
 * `grantsSourceAccess`). O sintoma teria sido mudo — o bloco *"Nunca vendeu,
 * sem de-para"* simplesmente nunca apareceria, e ninguém saberia por quê.
 *
 * ## Tom neutro, nunca `erro`
 *
 * Ao contrário do `SegredoBloco`, a ausência aqui **não quebra nada**: sem as
 * três credenciais o job pula o tenant em silêncio, o bloco 3 não aparece, e as
 * vendas continuam entrando pelo webhook normalmente. Pintar de vermelho uma
 * configuração opcional treinaria o operador a ignorar vermelho — que é o que
 * torna inútil o vermelho do segredo do webhook, esse sim uma venda parada.
 *
 * ## Dois campos comuns e um write-only
 *
 * `client_id` e `account_id` voltam da rota e são exibidos; o `client_secret`
 * nunca. **Não é inconsistência** — é a assimetria da própria dashboard da
 * Kiwify, onde os dois primeiros aparecem em claro e o terceiro mascarado.
 * Esconder o que o operador lê na outra aba do navegador só tiraria dele a
 * chance de conferir o que configurou aqui.
 *
 * ## Os três de uma vez
 *
 * O `PUT` aceita campo a campo, mas a tela salva os três juntos: *configurado* é
 * ter os três, e salvar dois produziria um estado que só falha de madrugada,
 * com `fetchError` indistinguível de credencial revogada.
 */
function KiwifyApiBloco({
  settings,
  onMudou,
}: {
  settings: LicSettingsView | null;
  onMudou: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accountId, setAccountId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const configurado = settings?.kiwifyApiConfigured ?? false;

  // Os valores já gravados entram nos campos: o operador edita o que existe em
  // vez de redigitar tudo para trocar um. O secret fica vazio — ele não volta.
  useEffect(() => {
    if (!settings) return;
    setClientId(settings.kiwifyClientId ?? '');
    setAccountId(settings.kiwifyAccountId ?? '');
  }, [settings]);

  const completo =
    clientId.trim() !== '' && clientSecret.trim() !== '' && accountId.trim() !== '';

  async function salvar() {
    setOcupado(true);
    try {
      await updateLicensingSettings({
        kiwifyClientId: clientId.trim(),
        kiwifyClientSecret: clientSecret.trim(),
        kiwifyAccountId: accountId.trim(),
      });
      setClientSecret('');
      onMudou();
      toast.success('Credenciais da API da Kiwify salvas');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Cartao tom="neutro">
      <TituloSecao
        titulo="API da Kiwify (catálogo)"
        descricao="Lê o catálogo para mostrar a oferta sem de-para antes da primeira venda."
        etiqueta={
          settings ? (
            <Etiqueta tom={configurado ? 'ok' : 'neutro'} ponto={!configurado}>
              {configurado ? 'configurado' : 'opcional'}
            </Etiqueta>
          ) : undefined
        }
      />

      <p className="m-0 mt-3 max-w-[72ch] text-[12px] leading-relaxed text-body">
        {configurado ? (
          <>
            Um job diário traz o catálogo, e a aba{' '}
            <strong className="text-text2">Oferta → edição</strong> mostra o que
            ainda não tem de-para. O <strong className="text-text2">client_secret</strong>{' '}
            não é exibido — para trocá-lo, cole o novo valor.
          </>
        ) : (
          <>
            Sem isto nada quebra: as vendas continuam entrando pelo webhook. O que
            você perde é o aviso{' '}
            <strong className="text-text2">antes da primeira venda</strong> — a
            oferta criada na Kiwify e sem de-para só apareceria quando alguém
            pagasse e a entrega falhasse.
          </>
        )}
      </p>

      <p className="m-0 mt-2 max-w-[72ch] text-[11px] leading-relaxed text-body2">
        Os três valores ficam na dashboard da Kiwify, em{' '}
        <strong className="text-text2">Apps → API</strong>, na chave com o escopo{' '}
        <strong className="text-text2">Produtos</strong> habilitado. O{' '}
        <code className="font-mono text-[10.5px] text-dim">client_secret</code>{' '}
        aparece mascarado lá também: se não o tiver anotado, gere uma chave nova.
      </p>

      <div className="mt-3 grid gap-2">
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="client_id"
          aria-label="client_id da Kiwify"
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text transition-colors focus:border-accentBorder"
        />
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={configurado ? 'client_secret (cole para trocar)' : 'client_secret'}
          aria-label="client_secret da Kiwify"
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text transition-colors focus:border-accentBorder"
        />
        <div className="grid gap-2 min-[720px]:grid-cols-[1fr_auto]">
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="account_id"
            aria-label="account_id da Kiwify"
            disabled={ocupado}
            className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12px] text-text transition-colors focus:border-accentBorder"
          />
          <button
            onClick={salvar}
            disabled={ocupado || !completo}
            className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>

      {/* O botão exige os três **antes** de habilitar, e não depois de recusar:
          o servidor recusaria de qualquer forma (string vazia é `422`), mas
          descobrir isso depois do clique é pior do que ver o botão apagado. */}
      {!completo && (
        <p className="m-0 mt-2 text-[11px] text-body2">
          Os três campos são necessários — configurado é ter os três.
        </p>
      )}
    </Cartao>
  );
}
