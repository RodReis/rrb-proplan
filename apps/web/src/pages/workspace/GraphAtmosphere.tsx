import { useTheme } from '../../theme';

/**
 * Atmosfera do canvas do Grafo.
 *
 * O canvas era `--bg` chapado e o grafo boiava no vazio. Aqui ele ganha
 * profundidade sem cor nova: no Carbono, um céu noturno (o grafo *é* uma
 * constelação de documentos — a metáfora já estava lá); no Claro, a bruma
 * equivalente, porque céu estrelado em tema claro viraria sujeira na tela.
 *
 * **Tudo em CSS**: zero asset, zero request, nada para otimizar depois. E
 * **estático**: estrela que pisca seria loop parado (§9), e já gastamos duas
 * exceções (pulso e Ken Burns). A profundidade vem de camadas — três tamanhos
 * de ponto em opacidades diferentes —, não de movimento.
 */
export function GraphAtmosphere() {
  const { theme } = useTheme();
  const dark = theme === 'carbono';

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {dark ? <NightSky /> : <DayHaze />}
    </div>
  );
}

/**
 * Céu noturno: três camadas de estrelas + um brilho de horizonte baixo.
 *
 * Cada camada é um `radial-gradient` repetido em tile — o `background-size`
 * diferente por camada evita que os pontos formem grade visível, que é o que
 * denuncia estrela feita em CSS.
 */
function NightSky() {
  return (
    <>
      {/* Poeira estelar: pontos minúsculos, densos, quase no limiar. */}
      <div className="absolute inset-0" style={{ ...starLayer(STAR_DUST), opacity: 0.7 }} />
      {/* Estrelas médias, mais esparsas. */}
      <div className="absolute inset-0" style={{ ...starLayer(STAR_MID), opacity: 0.85 }} />
      {/* As poucas estrelas grandes que dão escala às outras. */}
      <div className="absolute inset-0" style={starLayer(STAR_BRIGHT)} />
      {/* Brilho de horizonte: a luz que sobra de uma cidade distante. Ancora o
          céu — sem ele o campo de pontos flutua sem chão. */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/3"
        style={{
          background:
            'linear-gradient(to top, color-mix(in srgb, var(--accent) 7%, transparent), transparent)',
        }}
      />
    </>
  );
}

/**
 * Bruma diurna: o análogo do céu para o tema Claro. Mesma função — tirar o
 * fundo chapado e dar profundidade —, sem fingir que é noite.
 */
function DayHaze() {
  return (
    <>
      {/**
       * Partículas em `--muted` a 55% (2.26:1 contra o canvas). A primeira
       * versão usava `--dim` a 30% com `opacity .5` por cima: dava **1.33:1**
       * e o tema Claro ficava branco liso.
       *
       * A lição, medida: o céu escuro funciona porque a estrela tem ~15:1 de
       * espaço contra o preto. No branco não existe esse espaço — cinza claro
       * sobre quase-branco não vai a lugar nenhum. Aqui o valor precisa ser
       * bem mais escuro para produzir a *mesma* sutileza percebida.
       *
       * 2.26:1 é deliberado: fica abaixo da aresta (2.97:1) para a atmosfera
       * não competir com a informação do grafo.
       */}
      <div
        className="absolute inset-0"
        style={{
          ...starLayer(HAZE_NEAR),
          opacity: 0.85,
        }}
      />
      <div className="absolute inset-0" style={{ ...starLayer(HAZE_FAR), opacity: 0.6 }} />
      {/* Duas massas de luz difusa em diagonal: o mesmo papel do brilho de
          horizonte do céu — dar um "onde" ao espaço vazio. A 22% (1.35:1):
          presença, não forma. */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(900px 500px at 78% 12%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 62%),
            radial-gradient(700px 400px at 15% 85%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 62%)`,
        }}
      />
    </>
  );
}

/** Camada de partículas da bruma — mesmo mecanismo de tile das estrelas. */
const HAZE_NEAR: StarSpec = {
  points: [
    [12, 18], [47, 8], [78, 33], [26, 62], [63, 77], [91, 55], [37, 41], [8, 88],
    [55, 24], [71, 91], [19, 5], [88, 12], [34, 96], [96, 74], [3, 37], [59, 51],
  ],
  size: 1.2,
  tile: 170,
  color: '--muted',
  alpha: 55,
};

const HAZE_FAR: StarSpec = {
  points: [[22, 31], [68, 14], [85, 71], [41, 86], [9, 54], [53, 62], [77, 43]],
  size: 1.6,
  tile: 280,
  color: '--muted',
  alpha: 70,
};


interface StarSpec {
  /** Posições em % dentro do tile — irregulares de propósito (grade denuncia). */
  points: [number, number][];
  size: number;
  tile: number;
  /** Token da cor da estrela. */
  color: string;
  alpha: number;
}

// Os pontos cobrem o tile em todas as faixas de altura: com poucos pontos e
// tile grande, sobravam corredores horizontais vazios que denunciavam o
// padrão. Posições irregulares de propósito — grade regular não parece céu.
const STAR_DUST: StarSpec = {
  points: [
    [12, 18], [47, 8], [78, 33], [26, 62], [63, 77], [91, 55], [37, 41], [8, 88],
    [55, 24], [71, 91], [19, 5], [88, 12], [34, 96], [96, 74], [3, 37], [59, 51],
  ],
  size: 1,
  tile: 160,
  color: '--muted',
  alpha: 60,
};

const STAR_MID: StarSpec = {
  points: [
    [22, 31], [68, 14], [85, 71], [41, 86], [9, 54], [53, 62], [77, 43], [31, 9],
    [95, 27], [15, 76],
  ],
  size: 1.5,
  tile: 250,
  color: '--body',
  alpha: 75,
};

const STAR_BRIGHT: StarSpec = {
  points: [[31, 23], [74, 47], [17, 79], [58, 88], [89, 8], [44, 57]],
  size: 2,
  tile: 380,
  color: '--text',
  alpha: 92,
};

/** Monta uma camada de estrelas como gradientes radiais em tile. */
function starLayer(spec: StarSpec): React.CSSProperties {
  const dot = `color-mix(in srgb, var(${spec.color}) ${spec.alpha}%, transparent)`;
  return {
    backgroundImage: spec.points
      .map(
        ([x, y]) =>
          `radial-gradient(${spec.size}px ${spec.size}px at ${x}% ${y}%, ${dot}, transparent)`,
      )
      .join(','),
    backgroundSize: `${spec.tile}px ${spec.tile}px`,
  };
}
