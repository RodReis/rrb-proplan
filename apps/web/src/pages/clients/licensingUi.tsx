import type { ReactNode } from 'react';

/**
 * Vocabulário visual do licenciamento (SPEC-036/038/039/040/041).
 *
 * Existe porque a área tem **cinco abas montadas por painéis diferentes**, e
 * cada uma reinventava badge, cartão e cabeçalho com uma classe ligeiramente
 * diferente. Duas telas que dizem a mesma coisa de dois jeitos ensinam o
 * operador a reler tudo — e o produto inteiro fica mais lento de usar.
 *
 * ## Por que o tom é dado, não decoração
 *
 * O DESIGN.md §1 é explícito: **cor só carrega significado**. Aqui isso é
 * literal — `tom` é a resposta a *"isso pede alguma coisa de mim?"*:
 *
 * - `ok` — resolvido, nada a fazer (verde)
 * - `atencao` — depende de terceiro, espera por natureza (âmbar)
 * - `erro` — falhou, alguém precisa agir (vermelho dessaturado)
 * - `neutro` — informação sem estado
 *
 * ## O `danger` que não existia
 *
 * As telas de licenciamento usavam `text-danger` e `border-danger`. **Nenhum dos
 * dois está no `@theme`** do `index.css`, então o Tailwind não gerava a classe e
 * o alerta mais grave da área — *"assinatura não configurada"* — era desenhado
 * sem vermelho nenhum. O token correto sempre foi `error`; é ele que este
 * arquivo usa, e é por isso que as cores só aparecem agora.
 */

export type Tom = 'ok' | 'atencao' | 'erro' | 'neutro' | 'info';

/**
 * Classes por tom, em três materiais: borda+texto (badge), fundo tonal (cartão)
 * e a cor pura (números).
 *
 * `color-mix` no fundo em vez de opacidade fixa: o mesmo token precisa funcionar
 * sobre `--panel` (Carbono, quase preto) e sobre `--panel` do Claro (quase
 * branco), e uma cor sólida clara sumiria num deles.
 */
const TONS: Record<Tom, { badge: string; tinta: string; barra: string }> = {
  ok: {
    badge: 'border-success/40 bg-success/10 text-success',
    tinta: 'text-success',
    barra: 'bg-success',
  },
  atencao: {
    badge: 'border-warning/45 bg-warning/10 text-warning',
    tinta: 'text-warning',
    barra: 'bg-warning',
  },
  erro: {
    badge: 'border-error/45 bg-error/10 text-error',
    tinta: 'text-error',
    barra: 'bg-error',
  },
  info: {
    badge: 'border-info/40 bg-info/10 text-info',
    tinta: 'text-info',
    barra: 'bg-info',
  },
  neutro: {
    badge: 'border-border2 bg-card text-body2',
    tinta: 'text-body',
    barra: 'bg-border2',
  },
};

/**
 * Etiqueta de estado — o mesmo objeto em toda a área.
 *
 * Mono e caixa alta seguindo o DESIGN.md (rótulo técnico). O ponto colorido
 * antes do texto é o que torna o estado legível **antes** da leitura: numa lista
 * de vinte licenças, a varredura é pela cor, não pela palavra.
 */
export function Etiqueta({
  tom = 'neutro',
  children,
  ponto = true,
}: {
  tom?: Tom;
  children: ReactNode;
  ponto?: boolean;
}) {
  return (
    <span
      className={
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-px font-mono text-[10px] uppercase tracking-[0.06em] ' +
        TONS[tom].badge
      }
    >
      {ponto && (
        <span aria-hidden className={'h-1.5 w-1.5 rounded-full ' + TONS[tom].barra} />
      )}
      {children}
    </span>
  );
}

/**
 * Cartão de conteúdo — a superfície padrão de toda seção da área.
 *
 * `tom` tinge a borda quando a seção inteira está num estado (uma aba de
 * pendências com falhas, por exemplo). Sem tom, é a borda neutra de sempre: o
 * caso comum não deve competir por atenção com o caso que pede ação.
 */
export function Cartao({
  children,
  tom = 'neutro',
  className = '',
}: {
  children: ReactNode;
  tom?: Tom;
  className?: string;
}) {
  const borda =
    tom === 'neutro'
      ? 'border-border'
      : tom === 'erro'
        ? 'border-error/35'
        : tom === 'atencao'
          ? 'border-warning/35'
          : tom === 'ok'
            ? 'border-success/30'
            : 'border-info/30';

  return (
    <section className={`rounded-[14px] border ${borda} bg-panel p-5 ${className}`}>
      {children}
    </section>
  );
}

/**
 * Cabeçalho de seção: título, contador opcional e ações à direita.
 *
 * Padronizado porque cada painel montava o seu — e a diferença de 1 px no
 * espaçamento entre abas é exatamente o tipo de coisa que faz a interface
 * parecer montada por gente diferente.
 */
export function TituloSecao({
  titulo,
  descricao,
  etiqueta,
  acoes,
}: {
  titulo: string;
  descricao?: ReactNode;
  etiqueta?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-text">
          {titulo}
          {etiqueta}
        </h2>
        {descricao && (
          <p className="m-0 mt-1 max-w-[72ch] text-[11.5px] leading-relaxed text-body2">
            {descricao}
          </p>
        )}
      </div>
      {acoes && <div className="flex shrink-0 flex-wrap gap-1.5">{acoes}</div>}
    </div>
  );
}

/**
 * Linha de lista com reação ao ponteiro.
 *
 * O hover levanta a borda em vez de mover o bloco: `translate` numa lista longa
 * empurra tudo abaixo e faz a página tremer sob o cursor. Aqui só a borda e o
 * fundo mudam — 150 ms, dentro da faixa do register de produto.
 */
export function LinhaCartao({
  children,
  tom = 'neutro',
  className = '',
}: {
  children: ReactNode;
  tom?: Tom;
  className?: string;
}) {
  const borda =
    tom === 'erro'
      ? 'border-error/40 hover:border-error/60'
      : tom === 'atencao'
        ? 'border-warning/40 hover:border-warning/60'
        : tom === 'ok'
          ? 'border-success/35 hover:border-success/55'
          : 'border-border2 hover:border-border3';

  return (
    <li
      className={`rounded-[11px] border ${borda} bg-card px-4 py-3 transition-colors duration-150 ${className}`}
    >
      {children}
    </li>
  );
}

/**
 * Número com rótulo — o par que as métricas repetem dezenas de vezes.
 *
 * O `tom` pinta **só quando o número justifica**: zero reembolso é notícia boa e
 * não deve acender vermelho. Quem decide é o chamador, porque a regra é do dado,
 * não do componente.
 */
export function Metrica({
  valor,
  rotulo,
  tom = 'neutro',
  destaque = false,
}: {
  valor: number | string;
  rotulo: string;
  tom?: Tom;
  destaque?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <span
        className={
          'font-mono leading-none ' +
          (destaque ? 'text-[28px] ' : 'text-[22px] ') +
          (tom === 'neutro' ? 'text-text' : TONS[tom].tinta)
        }
      >
        {valor}
      </span>
      <span className="text-[11.5px] text-body">{rotulo}</span>
    </div>
  );
}

/** A cor pura de um tom — para gráfico e detalhes que não são badge. */
export function tintaDe(tom: Tom): string {
  return TONS[tom].tinta;
}

export function barraDe(tom: Tom): string {
  return TONS[tom].barra;
}

/**
 * Aviso de bloco — o alerta que precede o conteúdo.
 *
 * Substitui o `<p>` com `border-danger` que não pintava nada. O ícone entra como
 * texto e não como SVG porque a área não tem sistema de ícones próprio, e
 * introduzir um aqui criaria a sexta forma de dizer "atenção" nesta tela.
 */
export function Aviso({
  tom = 'atencao',
  children,
}: {
  tom?: Tom;
  children: ReactNode;
}) {
  const cor =
    tom === 'erro'
      ? 'border-error/45 bg-error/10'
      : tom === 'ok'
        ? 'border-success/40 bg-success/10'
        : 'border-warning/45 bg-warning/10';

  return (
    <p
      role="alert"
      className={`m-0 rounded-[11px] border ${cor} px-4 py-3 text-[12.5px] leading-relaxed text-text2`}
    >
      {children}
    </p>
  );
}
