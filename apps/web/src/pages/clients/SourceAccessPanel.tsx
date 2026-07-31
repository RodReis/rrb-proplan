import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  listSourcePending,
  reinviteSource,
  removeSourceAccess,
  setLicenseGithubUsername,
  type SourcePendingItem,
} from '../../lib/api';
import { shortDateTime } from './licensingView';
import {
  actionableCount,
  canReinvite,
  canRemoveAccess,
  nextActionText,
  reasonLabel,
  reconcileSummary,
  removalOutcomeText,
} from './sourceOpsView';
import { Cartao, Etiqueta, LinhaCartao, TituloSecao, type Tom } from './licensingUi';

/**
 * Acesso ao repo source — **contagem e ação no mesmo bloco**, dentro de Métricas
 * (decisão do PI, 2026-07-31).
 *
 * ## Por que sair de Pendências
 *
 * O assunto estava partido em duas abas: Métricas mostrava *quantos* estavam em
 * cada estado, Pendências mostrava *quem* e oferecia os botões. Nenhuma das
 * metades bastava — a que tinha número não agia, e a que agia não dizia o
 * tamanho do problema. Pior: as duas se chamavam "Acesso ao código-fonte", então
 * a mesma pergunta tinha dois lugares e nenhuma resposta inteira.
 *
 * ## A pergunta que este bloco responde
 *
 * *"Quem comprou o código-fonte já está no repositório?"* — e, quando não está,
 * *"o que eu faço?"*.
 *
 * Os PRs 3 e 4 da SPEC-039 gravam três estados que **pedem gente** e não se
 * resolvem sozinhos: `PENDING` sem username (o comprador não respondeu),
 * `INVITED` parado (não aceitou) e `FAILED` (o GitHub recusou). O beco aqui é
 * caro: a edição com código-fonte é a mais cara do catálogo, e "comprou e não
 * recebeu" vira ticket com o cliente já pago.
 *
 * ## O que este bloco NÃO diz, e é regra da spec
 *
 * **Remover o colaborador não recupera o que já foi clonado.** O §Objetivo é
 * explícito: *"painel que sugira 'acesso revogado = código recuperado' mente
 * para o operador"*. O que a remoção entrega é o fim dos *updates* — o mecanismo
 * real é contratual (§8 do MVP4).
 *
 * O PAT **não** mora aqui: token é configuração, e vive na aba Configurações.
 */
export function SourceAccessPanel() {
  const [itens, setItens] = useState<SourcePendingItem[]>([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      setItens(await listSourcePending());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível carregar');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const acionaveis = actionableCount(itens);
  const esperando = itens.length - acionaveis;

  return (
    <Cartao tom={acionaveis > 0 ? 'atencao' : 'neutro'}>
      <TituloSecao
        titulo="Acesso ao código-fonte"
        descricao="Quem comprou a edição com código-fonte e ainda não está no repositório."
        etiqueta={
          <>
            {/* Só conta o que pede ação NOSSA. `invited_not_accepted` fica de
                fora do número urgente: depende do comprador clicar, e contá-lo
                faria o contador nunca zerar. */}
            {acionaveis > 0 && (
              <Etiqueta tom="atencao">
                {acionaveis} {acionaveis === 1 ? 'pendência' : 'pendências'}
              </Etiqueta>
            )}
            {esperando > 0 && (
              <Etiqueta tom="neutro">
                {esperando} aguardando o comprador
              </Etiqueta>
            )}
          </>
        }
      />

      {carregando ? (
        <div
          aria-hidden
          className="mt-4 h-16 animate-pulse rounded-[11px] border border-border2 bg-card"
        />
      ) : itens.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-body">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
          Nenhuma pendência — todo comprador com direito ao código-fonte já foi
          convidado.
        </p>
      ) : (
        <ul className="mt-4 grid list-none gap-2 p-0">
          {itens.map((item) => (
            <PendenciaItem key={item.licenseId} item={item} onMudou={() => void carregar()} />
          ))}
        </ul>
      )}
    </Cartao>
  );
}

/**
 * Tom da linha pelo motivo.
 *
 * **Só `failed` é erro.** "Aguardando o comprador" e "convite não aceito" são o
 * processo andando — o comprador ainda não leu o e-mail, ou não clicou. Pintá-los
 * de vermelho faria o operador caçar defeito onde só falta gente responder, e o
 * `FAILED` de verdade (PAT expirado, 403) se perderia no meio.
 */
function tomDoMotivo(reason: SourcePendingItem['reason']): Tom {
  if (reason === 'failed') return 'erro';
  if (reason === 'awaiting_username') return 'atencao';
  return 'neutro';
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

  const tom = tomDoMotivo(item.reason);

  return (
    <LinhaCartao tom={tom}>
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
        <Etiqueta tom={tom}>{reasonLabel(item.reason)}</Etiqueta>
      </div>

      {/* O "e agora?" — cada motivo tem uma ação diferente, e sem isto o operador
          olha um enum e adivinha. */}
      <p className="m-0 mt-2 text-[11.5px] leading-relaxed text-body">
        {nextActionText(item)}
      </p>

      {/* O motivo da falha é o que diz o que consertar antes de reemitir. */}
      {item.sourceAccessError && (
        <p className="m-0 mt-2 rounded-[9px] border border-error/30 bg-error/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-error">
          {item.sourceAccessError}
        </p>
      )}

      <div className="mt-3 grid gap-2 min-[720px]:grid-cols-[1fr_auto_auto_auto]">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username do GitHub"
          aria-label={`Username do GitHub de ${item.customerEmail}`}
          disabled={ocupado}
          className="rounded-[9px] border border-border2 bg-bg px-3 py-2 font-mono text-[12.5px] text-text transition-colors focus:border-accentBorder"
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
            className="rounded-[9px] border border-border2 px-3 py-2 text-[12.5px] text-text2 transition-colors hover:border-hoverb hover:text-text disabled:opacity-50"
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
            className="rounded-[9px] border border-error/45 px-3 py-2 text-[12.5px] text-error transition-colors hover:bg-error/10 disabled:opacity-50"
          >
            Remover acesso
          </button>
        )}
      </div>
    </LinhaCartao>
  );
}
