#!/usr/bin/env node
/**
 * Guarda: classe de cor do Tailwind cujo token não existe no `@theme`.
 *
 * ## Por que isto existe
 *
 * No Tailwind 4 a paleta vem do bloco `@theme` do `index.css`. Uma classe como
 * `text-danger` só produz CSS se houver `--color-danger` ali. Se não houver, o
 * Tailwind **não gera nada e não reclama**: o build passa, o lint passa, o teste
 * de componente passa (ninguém asserta cor computada) e a tela sai sem a cor —
 * texto de erro herdando a cor do pai, borda de aviso simplesmente ausente.
 *
 * Foi exatamente o que aconteceu com `danger`: 18 classes mortas em 8 arquivos,
 * incluindo o painel de exclusão de dados a pedido do titular, cujo aviso *"Isto
 * não tem volta"* saía na cor do texto comum. O FIX #232 corrigiu uma parte da
 * área e o resto sobreviveu mais de um mês sem ninguém ver.
 *
 * O modo de falha é **silêncio**, e silêncio não se pega revisando com mais
 * atenção — se pega com uma verificação que quebra o CI. É a mesma escolha das
 * guardas de evidência do ADR-019.
 *
 * ## O que ela faz
 *
 * Lê os tokens `--color-*` do `@theme`, varre os `.tsx`/`.ts` por classes de cor
 * e aponta as que não têm token. Nada de parser de CSS nem de AST: o alvo é uma
 * classe literal em `className`, que é texto.
 *
 * ## O que ela deliberadamente NÃO faz
 *
 * - **Não olha classe montada em runtime** (`` `text-${tom}` ``). Fora de alcance
 *   para regex — e o Tailwind também não a geraria, então o caso já é problema
 *   conhecido de quem escreve concatenação de classe.
 * - **Não valida cor arbitrária** (`text-[#ff0000]`): tem valor literal, gera CSS.
 * - **Não valida as cores nativas do Tailwind** (`text-red-500`, `bg-white`): vêm
 *   da paleta padrão, não do `@theme`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// `import.meta.dirname` como no `test-report.mjs` — o config do ESLint não
// declara `URL` como global de `scripts/`, e um global novo por causa de um
// script é mais mudança do que o problema pede.
const raiz = resolve(import.meta.dirname, '..');
const cssPath = join(raiz, 'apps/web/src/index.css');
const srcDir = join(raiz, 'apps/web/src');

/** Prefixos de utilitário que consomem a paleta `--color-*`. */
const PREFIXOS = [
  'text',
  'bg',
  'border',
  'ring',
  'outline',
  'divide',
  'from',
  'via',
  'to',
  'fill',
  'stroke',
  'shadow',
  'accent',
  'caret',
  'decoration',
];

/**
 * Nomes que o Tailwind resolve pela paleta nativa ou por palavra-chave, não pelo
 * `@theme`. Sem esta lista a guarda acusaria `border-transparent` e `text-white`.
 */
const NATIVOS = new Set([
  'inherit',
  'current',
  'transparent',
  'black',
  'white',
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
]);

/**
 * Os prefixos acima são ambíguos: `text-` também dimensiona (`text-xs`) e alinha
 * (`text-center`), `border-` também escolhe lado (`border-b`) e estilo
 * (`border-dashed`), `shadow-` também tem tamanhos nomeados. Sem esta lista a
 * guarda acusa ~650 classes legítimas — e guarda que grita em tudo é guarda que
 * se aprende a ignorar, que é pior do que não ter.
 *
 * Só entra aqui o que o Tailwind resolve **sem** consultar a paleta.
 */
const NAO_E_COR = new Set([
  // tamanho de fonte / sombra / ring
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl',
  '8xl', '9xl', 'md', 'none', 'inner',
  // alinhamento de texto
  'left', 'center', 'right', 'justify', 'start', 'end',
  // lado da borda
  't', 'r', 'b', 'l', 'x', 'y', 's', 'e',
  // estilo de borda / decoração
  'solid', 'dashed', 'dotted', 'double', 'hidden', 'groove', 'ridge',
  'underline', 'overline', 'wavy', 'line-through', 'no-underline',
  // repetição/tamanho de fundo
  'cover', 'contain', 'auto', 'fixed', 'local', 'scroll', 'repeat',
  'no-repeat', 'clip', 'gradient', 'ellipsis', 'wrap', 'nowrap', 'balance',
  'pretty', 'top', 'bottom', 'middle', 'super', 'sub', 'baseline',
]);

/** `accentBorder` → `accent-border`, a forma como o token vive no `@theme`. */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function tokensDoTema(css) {
  const bloco = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!bloco) {
    console.error('[check-color-tokens] não achei o bloco @theme em index.css');
    process.exit(2);
  }
  const nomes = new Set();
  for (const m of bloco[1].matchAll(/--color-([a-zA-Z0-9-]+)\s*:/g)) nomes.add(m[1]);
  return nomes;
}

function arquivosFonte(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosFonte(caminho, acc);
    else if (/\.tsx?$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

const tokens = tokensDoTema(readFileSync(cssPath, 'utf8'));
const padrao = new RegExp(
  String.raw`\b(?:${PREFIXOS.join('|')})-([a-z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*)(?:/\d{1,3})?\b`,
  'g',
);

const achados = [];
for (const arquivo of arquivosFonte(srcDir)) {
  const linhas = readFileSync(arquivo, 'utf8').split('\n');
  linhas.forEach((linha, i) => {
    // Comentário de linha é onde este projeto documenta os bugs já corrigidos —
    // inclusive o `danger` que originou esta guarda. Acusá-los faria a guarda
    // exigir que se apagasse a explicação do problema que ela previne.
    if (/^\s*(\/\/|\*|\/\*)/.test(linha)) return;
    // Caminho de URL e import trazem `from-status`, `to-do` e afins — texto que
    // casa com o padrão sem nunca ter sido classe.
    if (/(['"`])\/[^'"`]*\1|^\s*import\s|require\(/.test(linha)) return;
    for (const m of linha.matchAll(padrao)) {
      const nome = m[1];
      const token = kebab(nome);
      // O Tailwind 4 normaliza camelCase↔kebab-case: `border-accentBorder`
      // resolve por `--color-accent-border`. Comparar sem normalizar acusaria
      // ~30 classes que funcionam — conferido no CSS compilado.
      if (tokens.has(nome) || tokens.has(token)) continue;
      if (NATIVOS.has(nome.split('-')[0])) continue;
      if (NAO_E_COR.has(nome)) continue;
      // `border-t-transparent`, `divide-y-black`: lado + cor nativa.
      if (NAO_E_COR.has(nome.split('-')[0]) && NATIVOS.has(nome.split('-')[1])) continue;
      // `border-b-0`, `border-r-2`: lado + largura.
      if (/^[trblxyse]-\d+$/.test(nome)) continue;
      // Propriedade CSS citada em `transition`/`will-change`, não classe.
      if (/^(color|width|style|spacing|radius|opacity|image|position|size)$/.test(nome))
        continue;
      achados.push({
        arquivo: relative(raiz, arquivo).replace(/\\/g, '/'),
        linha: i + 1,
        classe: m[0],
      });
    }
  });
}

if (achados.length === 0) {
  console.log(
    `[check-color-tokens] OK: nenhuma classe de cor sem token (${tokens.size} tokens no @theme).`,
  );
  process.exit(0);
}

console.error(
  `[check-color-tokens] ${achados.length} classe(s) de cor sem token no @theme do index.css.`,
);
console.error(
  'O Tailwind NÃO gera CSS para elas: a cor some da tela sem erro de build.\n',
);
for (const a of achados) console.error(`  ${a.arquivo}:${a.linha}  ${a.classe}`);
console.error(
  '\nOu use um token existente, ou declare o novo em apps/web/src/index.css (@theme).',
);
process.exit(1);
