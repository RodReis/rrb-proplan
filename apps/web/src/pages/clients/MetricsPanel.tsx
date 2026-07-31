import { useCallback, useEffect, useState } from 'react';
import {
  getLicensingSummary,
  type LicensingPeriod,
  type LicensingSummary,
} from '../../lib/api';
import {
  PERIOD_LABELS,
  PERIOD_OPTIONS,
  alturasRelativas,
  preencherDias,
  salesLabel,
  salesState,
} from './licensingMetrics';
import { Cartao, Etiqueta, Metrica, TituloSecao } from './licensingUi';
import { SourceAccessPanel } from './SourceAccessPanel';

/**
 * As contagens do painel (SPEC-040 §Métricas) — **a primeira aba da área**
 * (decisão do PI, 2026-07-31).
 *
 * Métricas na frente porque a pergunta que se faz ao abrir licenciamento é
 * *"como está?"*, não *"emitir para quem?"*. Emitir é a tarefa de quando já se
 * sabe o que fazer; o painel é o que informa antes de decidir.
 *
 * **Nenhum valor em moeda, e o motivo aparece na tela — não só na spec.** Preço
 * não é do ProPlan (decisão #4 do MVP4): ele vive no payload do webhook, sem
 * coluna tipada nem moeda normalizada. Um total derivado dali seria plausível e
 * indefensável. No lugar do número, o link para a plataforma — que é onde
 * dinheiro se confere.
 *
 * **Sem polling** (§2.10 da SPEC-035): atualiza ao montar, ao trocar o período
 * e ao voltar o foco. Clicar de volta numa janela que nunca esteve oculta não é
 * *voltar* — e dispararia uma request a cada alt-tab.
 *
 * ## O acesso ao código-fonte mora aqui agora
 *
 * Ele estava partido: contagem em Métricas, lista acionável em Pendências. Duas
 * abas respondendo à mesma pergunta com metades diferentes — e a metade com os
 * números não tinha como agir, enquanto a metade com os botões não dizia o
 * tamanho do problema. Reunidos (decisão do PI, 2026-07-31), o bloco conta e
 * resolve no mesmo lugar.
 */
export function MetricsPanel() {
  const [period, setPeriod] = useState<LicensingPeriod>('30');
  const [dados, setDados] = useState<LicensingSummary | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados(await getLicensingSummary(period));
      setErro(null);
    } catch (err) {
      // **Falha não vira zero.** Um painel que mostrasse "0 vendas" quando a
      // request falhou afirmaria um fato — e o operador tomaria decisão sobre
      // um número que ninguém mediu.
      setErro(err instanceof Error ? err.message : 'não foi possível carregar');
    }
  }, [period]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void carregar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [carregar]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold text-text">Métricas</h2>
        <div
          role="group"
          aria-label="Período"
          className="flex flex-wrap gap-0.5 rounded-[10px] border border-border2 bg-panel p-0.5"
        >
          {PERIOD_OPTIONS.map((opcao) => (
            <button
              key={opcao}
              onClick={() => setPeriod(opcao)}
              aria-pressed={period === opcao}
              className={
                'rounded-[8px] px-3 py-1.5 text-[12px] transition-colors duration-150 ' +
                (period === opcao
                  ? 'bg-card font-semibold text-text'
                  : 'text-body2 hover:bg-card/60 hover:text-text')
              }
            >
              {PERIOD_LABELS[opcao]}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <p
          role="alert"
          className="m-0 rounded-[11px] border border-error/45 bg-error/10 px-4 py-3 text-[12.5px] text-text2"
        >
          <strong className="text-error">Não foi possível carregar.</strong> {erro}
        </p>
      )}

      {!dados && !erro && <EsqueletoMetricas />}

      {dados && (
        <>
          <Ativacoes dados={dados} />

          {/* `auto-rows-min` + `items-start`: sem eles, o cartão curto (uma
              frase de "nenhuma venda") estica até a altura do vizinho cheio de
              números e vira um retângulo oco. Cada um passa a ter a altura do
              próprio conteúdo. */}
          <div className="grid auto-rows-min items-start gap-4 min-[900px]:grid-cols-2">
            <Licencas dados={dados} />
            <Vendas dados={dados} />
            <Assinaturas dados={dados} />
          </div>

          {/* Acesso ao código-fonte: contagem **e** ação no mesmo bloco. */}
          <SourceAccessPanel />

          {/* **O motivo de não haver receita, na tela.** A spec manda escrevê-lo
              aqui e não só no documento: sem esta frase, a ausência de um total
              pareceria uma funcionalidade que falta — e a próxima pessoa a mexer
              nesta tela a "consertaria". */}
          <p className="max-w-[80ch] text-[11.5px] leading-relaxed text-body2">
            <strong className="text-body">Sem valores em dinheiro, de propósito.</strong>{' '}
            O preço não é registrado pelo ProPlan — ele chega dentro do evento da
            plataforma, sem formato garantido e sem moeda normalizada. Um total
            somado daí pareceria certo e não se sustentaria. Confira faturamento
            no painel da plataforma de venda.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Esqueleto no lugar de "Carregando…".
 *
 * O register de produto pede skeleton, não spinner: a página já sabe a forma que
 * vai ter, e mostrá-la evita o salto de layout quando os números chegam.
 */
function EsqueletoMetricas() {
  return (
    <div className="grid gap-4" aria-hidden>
      <div className="h-[152px] animate-pulse rounded-[14px] border border-border bg-panel" />
      <div className="grid gap-4 min-[900px]:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[104px] animate-pulse rounded-[14px] border border-border bg-panel"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Ativações por dia.
 *
 * As barras vêm do servidor **já no dia de São Paulo**; a tela só preenche as
 * lacunas — sem isso, três ativações em dias alternados apareceriam coladas,
 * sugerindo atividade contínua.
 */
function Ativacoes({ dados }: { dados: LicensingSummary }) {
  const barras = comLacunas(dados);
  const alturas = alturasRelativas(barras);
  const total = barras.reduce((soma, b) => soma + b.count, 0);
  const pico = Math.max(0, ...barras.map((b) => b.count));

  return (
    <Cartao>
      <TituloSecao
        titulo="Ativações"
        descricao={`Máquinas que ativaram uma licença em ${PERIOD_LABELS[dados.period].toLowerCase()}.`}
        etiqueta={total > 0 ? <Etiqueta tom="info">{total}</Etiqueta> : undefined}
      />

      {total === 0 ? (
        <p className="mt-4 text-[12.5px] text-body">
          Nenhuma ativação no período. Quando alguém instalar o produto com uma
          chave válida, a barra do dia aparece aqui.
        </p>
      ) : (
        <>
          {/* `max-w` por barra: com `flex-1` puro, dois dias viram dois blocos
              de 700 px que parecem um retângulo azul, não um gráfico. O teto
              mantém a forma de série temporal em qualquer tamanho de janela, e
              `justify-start` ancora à esquerda em vez de espalhar. */}
          <div className="mt-4 flex h-24 items-end justify-start gap-[3px]" aria-hidden>
            {barras.map((barra, i) => (
              <span
                key={barra.day}
                title={`${barra.day}: ${barra.count}`}
                style={{
                  height: `${Math.max(alturas[i] * 100, barra.count > 0 ? 8 : 2)}%`,
                }}
                className={
                  'w-full max-w-[26px] min-w-[3px] flex-1 rounded-t-[3px] transition-[height,background-color] duration-300 ease-out ' +
                  // O pico ganha a cor cheia; os demais dias com atividade ficam
                  // no acento translúcido. Sem isso, vinte barras iguais não
                  // dizem qual foi o dia que importou.
                  (barra.count === 0
                    ? 'bg-border2/70'
                    : barra.count === pico
                      ? 'bg-info'
                      : 'bg-info/45')
                }
              />
            ))}
          </div>
          {/* O gráfico é decorativo; o número é o dado. Um leitor de tela que
              só encontrasse barras não teria como saber quantas foram. */}
          <p className="mt-3 text-[12.5px] text-body">
            <strong className="font-mono text-[14px] text-text">{total}</strong>{' '}
            ativações em {barras.length} dias
            {pico > 0 && (
              <>
                {' · '}pico de <strong className="font-mono text-text2">{pico}</strong> num
                dia
              </>
            )}
            .
          </p>
        </>
      )}
    </Cartao>
  );
}

function Vendas({ dados }: { dados: LicensingSummary }) {
  const estado = salesState(dados);
  const problemas = dados.sales.refunded + dados.sales.chargeback;

  return (
    <Cartao tom={problemas > 0 ? 'atencao' : 'neutro'}>
      <TituloSecao
        titulo="Vendas"
        etiqueta={
          problemas > 0 ? (
            <Etiqueta tom="atencao">
              {problemas} {problemas === 1 ? 'devolução' : 'devoluções'}
            </Etiqueta>
          ) : undefined
        }
      />
      <div className="mt-4">
        {estado === 'com-vendas' ? (
          <div className="flex flex-wrap gap-7">
            <Metrica valor={dados.sales.approved} rotulo="aprovadas" tom="ok" destaque />
            <Metrica
              valor={dados.sales.refunded}
              rotulo="reembolsos"
              tom={dados.sales.refunded > 0 ? 'atencao' : 'neutro'}
            />
            <Metrica
              valor={dados.sales.chargeback}
              rotulo="chargebacks"
              tom={dados.sales.chargeback > 0 ? 'erro' : 'neutro'}
            />
          </div>
        ) : (
          // Os dois estados sem venda dizem coisas diferentes, e é a razão de
          // `everSold` viajar fora do recorte de período.
          <p className="text-[12.5px] text-body">{salesLabel(estado, dados.period)}</p>
        )}
      </div>
    </Cartao>
  );
}

function Licencas({ dados }: { dados: LicensingSummary }) {
  return (
    <Cartao>
      <TituloSecao titulo="Licenças" descricao="Estado atual, fora do recorte de período." />
      <div className="mt-4 flex flex-wrap gap-7">
        <Metrica
          valor={dados.licensesByStatus.active}
          rotulo="ativas"
          tom={dados.licensesByStatus.active > 0 ? 'ok' : 'neutro'}
          destaque
        />
        <Metrica valor={dados.licensesByStatus.revoked} rotulo="revogadas" />
        <Metrica valor={dados.licensesByStatus.expired} rotulo="expiradas" />
        <Metrica
          valor={dados.activeMachines}
          rotulo="máquinas em uso"
          tom={dados.activeMachines > 0 ? 'info' : 'neutro'}
        />
      </div>
    </Cartao>
  );
}

function Assinaturas({ dados }: { dados: LicensingSummary }) {
  const atrasadas = dados.subscriptions.pastDue;

  return (
    <Cartao tom={atrasadas > 0 ? 'atencao' : 'neutro'}>
      <TituloSecao
        titulo="Assinaturas"
        etiqueta={
          atrasadas > 0 ? <Etiqueta tom="atencao">{atrasadas} em atraso</Etiqueta> : undefined
        }
      />
      <div className="mt-4">
        {dados.subscriptions.active === 0 && atrasadas === 0 ? (
          <p className="text-[12.5px] text-body">Nenhuma assinatura ativa.</p>
        ) : (
          <div className="flex flex-wrap gap-7">
            <Metrica
              valor={dados.subscriptions.active}
              rotulo="ativas"
              tom={dados.subscriptions.active > 0 ? 'ok' : 'neutro'}
              destaque
            />
            <Metrica
              valor={atrasadas}
              rotulo="em atraso"
              tom={atrasadas > 0 ? 'atencao' : 'neutro'}
            />
          </div>
        )}
        {atrasadas > 0 && (
          // O atraso NÃO corta o acesso sozinho (SPEC-038): a plataforma retenta,
          // e o corte só vem depois da tolerância. Dizer isso aqui evita que o
          // operador revogue por engano quem ainda está no prazo.
          <p className="mt-3 rounded-[9px] border border-warning/30 bg-warning/5 px-3 py-2 text-[11.5px] leading-relaxed text-body">
            Atraso registrado <strong className="text-text2">não corta o acesso</strong> — a
            plataforma ainda retenta a cobrança dentro da tolerância configurada.
          </p>
        )}
      </div>
    </Cartao>
  );
}

/**
 * As barras com as lacunas preenchidas.
 *
 * O primeiro e o último dia saem das próprias contagens — e não de uma
 * aritmética de período repetida aqui. Repeti-la faria a tela ter uma segunda
 * opinião sobre onde a janela começa, e as duas divergiriam na virada do mês.
 */
function comLacunas(dados: LicensingSummary) {
  const dias = dados.activationsByDay;
  if (dias.length === 0) return [];
  return preencherDias(dias, dias[0].day, dias[dias.length - 1].day);
}
