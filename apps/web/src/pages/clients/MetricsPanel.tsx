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
  sourceRows,
} from './licensingMetrics';

/**
 * As contagens do painel (SPEC-040 §Métricas).
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
        <div role="group" aria-label="Período" className="flex flex-wrap gap-1.5">
          {PERIOD_OPTIONS.map((opcao) => (
            <button
              key={opcao}
              onClick={() => setPeriod(opcao)}
              aria-pressed={period === opcao}
              className={
                'rounded-[9px] px-3 py-1.5 text-[12px] transition-colors duration-150 ' +
                (period === opcao
                  ? 'bg-card font-semibold text-text'
                  : 'text-body2 hover:bg-card hover:text-text')
              }
            >
              {PERIOD_LABELS[opcao]}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <p role="alert" className="text-[13px] text-danger">
          {erro}
        </p>
      )}

      {!dados && !erro && <p className="text-[13px] text-body">Carregando…</p>}

      {dados && (
        <>
          <Ativacoes dados={dados} />

          <div className="grid gap-4 min-[900px]:grid-cols-2">
            <Vendas dados={dados} />
            <Licencas dados={dados} />
            <Assinaturas dados={dados} />
            <Source dados={dados} />
          </div>

          {/* **O motivo de não haver receita, na tela.** A spec manda escrevê-lo
              aqui e não só no documento: sem esta frase, a ausência de um total
              pareceria uma funcionalidade que falta — e a próxima pessoa a mexer
              nesta tela a "consertaria". */}
          <p className="text-[11.5px] leading-relaxed text-body2">
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

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-panel p-4">
      <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-body2">
        {titulo}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Numero({
  valor,
  rotulo,
  tom,
}: {
  valor: number;
  rotulo: string;
  tom?: 'normal' | 'alerta';
}) {
  return (
    <div className="grid gap-0.5">
      <span
        className={
          'font-mono text-[22px] leading-none ' +
          (tom === 'alerta' && valor > 0 ? 'text-danger' : 'text-text')
        }
      >
        {valor}
      </span>
      <span className="text-[11.5px] text-body">{rotulo}</span>
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

  return (
    <Bloco titulo={`Ativações — ${PERIOD_LABELS[dados.period]}`}>
      {total === 0 ? (
        <p className="text-[12.5px] text-body">
          Nenhuma ativação no período.
        </p>
      ) : (
        <>
          <div className="flex h-24 items-end gap-[3px]" aria-hidden>
            {barras.map((barra, i) => (
              <span
                key={barra.day}
                title={`${barra.day}: ${barra.count}`}
                style={{ height: `${Math.max(alturas[i] * 100, barra.count > 0 ? 6 : 2)}%` }}
                className={
                  'flex-1 rounded-t-[3px] ' +
                  (barra.count > 0 ? 'bg-accent' : 'bg-border2')
                }
              />
            ))}
          </div>
          {/* O gráfico é decorativo; o número é o dado. Um leitor de tela que
              só encontrasse barras não teria como saber quantas foram. */}
          <p className="mt-2 text-[12.5px] text-body">
            <strong className="font-mono text-text">{total}</strong> ativações em{' '}
            {barras.length} dias.
          </p>
        </>
      )}
    </Bloco>
  );
}

function Vendas({ dados }: { dados: LicensingSummary }) {
  const estado = salesState(dados);

  return (
    <Bloco titulo="Vendas">
      {estado === 'com-vendas' ? (
        <div className="flex flex-wrap gap-6">
          <Numero valor={dados.sales.approved} rotulo="aprovadas" />
          <Numero valor={dados.sales.refunded} rotulo="reembolsos" tom="alerta" />
          <Numero valor={dados.sales.chargeback} rotulo="chargebacks" tom="alerta" />
        </div>
      ) : (
        // Os dois estados sem venda dizem coisas diferentes, e é a razão de
        // `everSold` viajar fora do recorte de período.
        <p className="text-[12.5px] text-body">{salesLabel(estado, dados.period)}</p>
      )}
    </Bloco>
  );
}

function Licencas({ dados }: { dados: LicensingSummary }) {
  return (
    <Bloco titulo="Licenças (estado atual)">
      <div className="flex flex-wrap gap-6">
        <Numero valor={dados.licensesByStatus.active} rotulo="ativas" />
        <Numero valor={dados.licensesByStatus.revoked} rotulo="revogadas" />
        <Numero valor={dados.licensesByStatus.expired} rotulo="expiradas" />
        <Numero valor={dados.activeMachines} rotulo="máquinas em uso" />
      </div>
    </Bloco>
  );
}

function Assinaturas({ dados }: { dados: LicensingSummary }) {
  return (
    <Bloco titulo="Assinaturas">
      {dados.subscriptions.active === 0 ? (
        <p className="text-[12.5px] text-body">Nenhuma assinatura ativa.</p>
      ) : (
        <div className="flex flex-wrap gap-6">
          <Numero valor={dados.subscriptions.active} rotulo="ativas" />
          <Numero valor={dados.subscriptions.pastDue} rotulo="em atraso" tom="alerta" />
        </div>
      )}
      {dados.subscriptions.pastDue > 0 && (
        // O atraso NÃO corta o acesso sozinho (SPEC-038): a plataforma retenta,
        // e o corte só vem depois da tolerância. Dizer isso aqui evita que o
        // operador revogue por engano quem ainda está no prazo.
        <p className="mt-2 text-[11.5px] text-body2">
          Atraso registrado não corta o acesso — a plataforma ainda retenta a
          cobrança dentro da tolerância configurada.
        </p>
      )}
    </Bloco>
  );
}

function Source({ dados }: { dados: LicensingSummary }) {
  const linhas = sourceRows(dados.sourceAccess);

  return (
    <Bloco titulo="Acesso ao código-fonte">
      {linhas.length === 0 ? (
        <p className="text-[12.5px] text-body">
          Nenhuma licença com acesso ao repositório.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {linhas.map((linha) => (
            <li
              key={linha.key}
              className="flex items-baseline justify-between gap-3 text-[12.5px]"
            >
              <span className={linha.urgente ? 'text-text2' : 'text-body'}>
                {linha.label}
              </span>
              <span
                className={
                  'font-mono text-[13px] ' +
                  (linha.urgente ? 'text-danger' : 'text-text')
                }
              >
                {linha.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
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
