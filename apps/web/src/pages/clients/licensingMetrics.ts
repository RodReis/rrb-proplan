import type { LicDailyCount, LicensingPeriod, LicensingSummary } from '../../lib/api';

/**
 * As decisões de leitura das métricas (SPEC-040 §Métricas), fora do componente.
 *
 * Funções puras porque **todo número da tela tem teste que prova a origem**
 * (MVP3 §9) — e um número que só existe dentro de JSX se testa por renderização,
 * que é o teste mais frágil que existe para conferir aritmética.
 */

/**
 * O domínio do marcador que a anonimização grava no lugar do e-mail.
 *
 * A tela precisa reconhecê-lo para **esconder as duas ações** de uma licença já
 * anonimizada: o marcador não é destinatário de nada, e "excluir de novo" não
 * tem o que excluir.
 *
 * É o mesmo valor do `ANONIMO_EMAIL` do servidor. Duplicado porque não há
 * pacote compartilhado entre api e web neste repo — e sufixo, não igualdade
 * exata, para que mudar a parte local do marcador lá não deixe esta tela
 * oferecendo uma exclusão que já aconteceu.
 */
export const ANONIMO_DOMINIO = '@removido.local';

export function isAnonimizada(licenca: { customerEmail: string }): boolean {
  return licenca.customerEmail.toLowerCase().endsWith(ANONIMO_DOMINIO);
}

export const PERIOD_LABELS: Record<LicensingPeriod, string> = {
  '7': '7 dias',
  '30': '30 dias',
  '90': '90 dias',
  current_month: 'Mês atual',
};

export const PERIOD_OPTIONS: LicensingPeriod[] = ['7', '30', '90', 'current_month'];

/**
 * O que a tela escreve no bloco de vendas.
 *
 * **`'nunca'` e `'zero'` são estados diferentes** (§2.7 da SPEC-035): *"nenhuma
 * venda no período"* é um fato sobre a janela; *"nunca vendeu"* é um fato sobre
 * o tenant. Renderizar os dois como "0" faria quem ainda não vendeu ler o
 * painel como queda — e quem teve um mês fraco, como se o produto não
 * existisse.
 */
export type SalesState = 'nunca' | 'zero' | 'com-vendas';

export function salesState(summary: {
  everSold: boolean;
  sales: { approved: number };
}): SalesState {
  if (!summary.everSold) return 'nunca';
  return summary.sales.approved === 0 ? 'zero' : 'com-vendas';
}

export function salesLabel(estado: SalesState, period: LicensingPeriod): string {
  if (estado === 'nunca') return 'Nenhuma venda registrada ainda';
  if (estado === 'zero') return `Nenhuma venda em ${PERIOD_LABELS[period].toLowerCase()}`;
  return 'Vendas no período';
}

/**
 * Preenche os dias sem ativação com zero, para o gráfico ter barras contíguas.
 *
 * **O servidor não devolve os dias vazios de propósito** — ele teria de conhecer
 * a janela inteira em dias, e `current_month` tem tamanho variável. Quem sabe
 * quantas barras cabem é a tela, então a lacuna se preenche aqui.
 *
 * Sem isto o gráfico mentiria por compressão: três ativações em 1º, 15 e 30
 * apareceriam como três barras vizinhas, sugerindo três dias seguidos de
 * atividade.
 */
export function preencherDias(
  contagens: LicDailyCount[],
  inicio: string,
  fim: string,
): LicDailyCount[] {
  if (fim < inicio) return [];

  const porDia = new Map(contagens.map((c) => [c.day, c.count]));
  const dias: LicDailyCount[] = [];
  // Aritmética em UTC sobre a data pura (`YYYY-MM-DD`): a string já é o dia de
  // São Paulo, resolvido no servidor. Reconvertê-la com fuso aqui a moveria de
  // novo — o erro de aplicar o mesmo deslocamento duas vezes.
  const cursor = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fim}T00:00:00Z`);

  while (cursor <= ultimo) {
    const dia = cursor.toISOString().slice(0, 10);
    dias.push({ day: dia, count: porDia.get(dia) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

/**
 * A altura relativa de cada barra, de 0 a 1.
 *
 * **Escala pelo maior valor, não por um teto fixo.** Um teto inventado faria um
 * pico de 3 ativações parecer irrelevante num painel calibrado para 100 — e o
 * volume do piloto é justamente esse.
 *
 * Tudo zero devolve tudo zero (não `NaN`): dividir por zero pintaria a régua
 * inteira de barras cheias afirmando atividade que não houve.
 */
export function alturasRelativas(contagens: LicDailyCount[]): number[] {
  const maior = Math.max(0, ...contagens.map((c) => c.count));
  if (maior === 0) return contagens.map(() => 0);
  return contagens.map((c) => c.count / maior);
}

/**
 * Os estados de acesso ao source que valem mostrar, em ordem de urgência.
 *
 * `NONE` fica de fora: ele é o estado de **toda licença que não vende
 * código-fonte**, ou seja, a maioria. Exibi-lo faria o bloco dizer "247 sem
 * acesso" sobre licenças que nunca deveriam ter acesso nenhum.
 */
export const SOURCE_STATES: Array<{ key: string; label: string; urgente: boolean }> = [
  { key: 'FAILED', label: 'Com falha', urgente: true },
  { key: 'PENDING', label: 'Aguardando o comprador', urgente: true },
  { key: 'INVITED', label: 'Convite não aceito', urgente: true },
  { key: 'ACTIVE', label: 'Com acesso', urgente: false },
  { key: 'REMOVED', label: 'Acesso removido', urgente: false },
];

export function sourceRows(
  sourceAccess: LicensingSummary['sourceAccess'],
): Array<{ key: string; label: string; count: number; urgente: boolean }> {
  return SOURCE_STATES.map((s) => ({
    ...s,
    count: sourceAccess[s.key] ?? 0,
  })).filter((s) => s.count > 0);
}
