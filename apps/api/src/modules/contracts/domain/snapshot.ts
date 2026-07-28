/**
 * Do dado vivo para o snapshot do contrato (SPEC-034 §2.5, §6). Regra pura —
 * sem Prisma, sem HTTP, sem Nest.
 *
 * ## Copia, não referencia
 *
 * Prestador, cliente, escopo, valor e horas viajam como **cópia** dentro da
 * linha do contrato. Se o documento lesse o `Client` por FK, corrigir o
 * endereço do cliente meses depois mudaria em silêncio o que está escrito num
 * contrato **já enviado** — e nada falharia.
 *
 * ## Os valores são `string`, e passar por `Number()` é o defeito a evitar
 *
 * O `calculation.ts` usa `Prisma.Decimal` e serializa como texto **de
 * propósito** (dinheiro em `Float` acumula erro de fração de centavo, ADR-016).
 * O contrato tem de imprimir exatamente o que a `Estimate` congelou, então a
 * formatação daqui trabalha sobre o texto: separa a parte inteira dos centavos
 * e agrupa milhares por manipulação de string. `toLocaleString` exigiria um
 * `Number` no caminho, que é justamente o que a §6 proíbe.
 */

import { escapeHtml } from './render';

/** O que o contrato guarda do prestador. */
export interface ProviderSnapshot {
  legalName: string;
  documentType: string;
  document: string;
  address: string;
  email: string | null;
  phone: string | null;
}

/** O que o contrato guarda do cliente. */
export interface ClientSnapshot {
  name: string;
  /** CPF ou CNPJ, o que existir — o contrato identifica a parte por um só. */
  document: string;
  documentType: 'cpf' | 'cnpj' | null;
  company: string | null;
  address: string;
}

/** O escopo aprovado, como estava no dia da emissão. */
export interface ScopeSnapshot {
  entregaveis: string[];
  foraDeEscopo: string[];
  premissas: string[];
  riscos: string[];
}

/** Endereço em uma linha. Campo vazio some — não deixa vírgula órfã. */
export function formatAddress(partes: {
  street?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string {
  const linha = [partes.street, partes.district, partes.city, partes.state]
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join(', ');

  const cep = (partes.zipCode ?? '').trim();
  if (cep === '') return linha;
  return linha === '' ? `CEP ${cep}` : `${linha} — CEP ${cep}`;
}

/**
 * `"12345.60"` → `"R$ 12.345,60"`, **sem passar por `Number`**.
 *
 * Devolve o texto original se ele não parecer um decimal: um valor que não dá
 * para formatar aparece como veio, e não como `R$ NaN` — o contrato erra em
 * voz alta, não em silêncio.
 */
export function formatBrlFromDecimalString(valor: string): string {
  const texto = valor.trim();
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(texto);
  if (!m) return texto;

  const [, sinal, inteiro, decimais = ''] = m;
  const centavos = `${decimais}00`.slice(0, 2);
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${agrupado},${centavos}`;
}

/**
 * `"120.00"` → `"120"`, `"1.50"` → `"1,5"`. Sem `Number` pelo mesmo motivo.
 *
 * Zeros à direita caem porque "120,00 horas" num contrato sugere precisão de
 * centésimo de hora que a estimativa não tem.
 */
export function formatHoursFromDecimalString(valor: string): string {
  const texto = valor.trim();
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(texto);
  if (!m) return texto;

  const [, sinal, inteiro, decimais = ''] = m;
  const fracao = decimais.replace(/0+$/, '');
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fracao === '' ? `${sinal}${agrupado}` : `${sinal}${agrupado},${fracao}`;
}

/** Rótulos das modalidades no corpo do contrato — o enum cru não se lê. */
export const MODALITY_LABELS: Record<string, string> = {
  desenvolvimento: 'desenvolvimento de software',
  desenvolvimento_manutencao: 'desenvolvimento e manutenção de software',
  desenvolvimento_venda_codigo: 'desenvolvimento com cessão de código-fonte',
};

/**
 * O escopo aprovado como texto do contrato.
 *
 * Cada seção vira título + lista em marcação. **Escapa item por item aqui**,
 * porque o `{{scope}}` é o único placeholder que entra no documento com
 * marcação própria (`MARKUP_PLACEHOLDERS`) e por isso não é reescapado pelo
 * renderizador. Sem este escape, um entregável digitado como
 * `<script>alert(1)</script>` viraria tag na página pública — o escopo vem de
 * um artefato que a IA gerou a partir do briefing que o **cliente** preencheu.
 *
 * Seção vazia **some**: um "Riscos" com lista vazia num contrato sugere que
 * ninguém preencheu, quando o certo é não haver a seção.
 */
export function scopeToMarkup(scope: ScopeSnapshot): string {
  const secoes: Array<[string, string[]]> = [
    ['Entregáveis', scope.entregaveis],
    ['Fora de escopo', scope.foraDeEscopo],
    ['Premissas', scope.premissas],
    ['Riscos', scope.riscos],
  ];

  return secoes
    .filter(([, itens]) => itens.length > 0)
    .map(([titulo, itens]) =>
      [`**${titulo}**`, itens.map((i) => `- ${escapeHtml(i)}`).join('\n')].join('\n\n'),
    )
    .join('\n\n');
}

/**
 * Lê o `content` da `ArtifactVersion` de escopo defensivamente.
 *
 * O conteúdo vem do `jsonb` e **pode ter sido editado à mão** (§2.10 da
 * SPEC-032): campo ausente ou com o tipo errado não pode derrubar a emissão com
 * um `TypeError` — vira lista vazia, e a seção some do documento.
 */
export function parseScope(content: unknown): ScopeSnapshot {
  const obj = (content ?? {}) as Record<string, unknown>;
  const lista = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : [];

  return {
    entregaveis: lista(obj.entregaveis),
    foraDeEscopo: lista(obj.foraDeEscopo),
    premissas: lista(obj.premissas),
    riscos: lista(obj.riscos),
  };
}

/** Cenário **provável** da `Estimate` — a escolha da §6, dita em voz alta. */
export function parseProvavel(scenarios: unknown): { horas: string; totalBrl: string } {
  const obj = (scenarios ?? {}) as Record<string, unknown>;
  const provavel = (obj.provavel ?? {}) as Record<string, unknown>;
  const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
  return { horas: texto(provavel.horas), totalBrl: texto(provavel.totalBrl) };
}

/** `28 de julho de 2026` — a data por extenso que um contrato traz. */
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function formatDateLong(data: Date): string {
  return `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`;
}
