/**
 * Stack detectada via SBOM do Dependency Graph (SPEC-023). Domínio PURO.
 *
 * Duas responsabilidades, ambas determinísticas (ADR-012 — confiança calculada,
 * nunca inferida): normalizar o SPDX que o GitHub deriva dos manifests, e
 * confrontar o detectado contra o que a doc declara.
 *
 * O confronto segue o padrão do ADR-018: **coroa nenhuma fonte**. Não existe
 * veredito "doc errada" nem "SBOM certo" — só `concorda`, `discorda` e os
 * estados de ausência. Quem decide quem mentiu é o humano lendo lado a lado.
 */

/** Um pacote SPDX normalizado — só nome+ecossistema, nunca bytes de código. */
export interface StackPackage {
  /** Ecossistema normalizado: `npm`, `pip`, `cargo`, … */
  ecosystem: string;
  /** Nome do pacote sem o prefixo de purl. */
  name: string;
  /** Versão quando o SPDX a traz; `null` quando o manifest não fixa. */
  version: string | null;
}

export interface StackDetection {
  /** `false` = Dependency Graph desabilitado, negado, ou repo sem manifests. */
  enabled: boolean;
  /** Ecossistemas distintos, ordenados por nº de pacotes (desc) e nome. */
  ecosystems: string[];
  packages: StackPackage[];
}

/** Veredito do confronto doc × SBOM. Nenhum valor eleje uma fonte vencedora. */
export type StackVerdict =
  /** doc declara e o SBOM detecta o mesmo conjunto de ecossistemas */
  | 'concorda'
  /** doc declara X, SBOM detecta Y, X≠Y — mostrar lado a lado, sem coroar */
  | 'discorda'
  /** doc não declara stack — informação, não erro (ADR-014: ausência informa) */
  | 'nao_declarado'
  /** DG desabilitado/vazio — não dá para confrontar, e isso não é falha da doc */
  | 'nao_detectado';

/** Resposta do endpoint SBOM, já desserializada (subset do SPDX que usamos). */
export interface SbomResponse {
  sbom?: {
    packages?: Array<{
      name?: string;
      versionInfo?: string;
      externalRefs?: Array<{ referenceLocator?: string; referenceType?: string }>;
    }>;
  };
}

/**
 * Ecossistemas que o `purl` do SPDX nomeia diferente do rótulo que o humano
 * escreve na doc. Só os que divergem entram — o resto passa direto.
 */
const ECOSYSTEM_ALIASES: Record<string, string> = {
  golang: 'go',
  pypi: 'pip',
  rubygems: 'gem',
};

/**
 * Purls que o SPDX traz mas NÃO são stack da aplicação — verificado contra o
 * SBOM real de `vercel/swr` (2026-07-25):
 *
 *  - `pkg:github/owner/repo@ref` — o nó raiz do grafo é o PRÓPRIO repositório.
 *  - `pkg:githubactions/*` — passos de CI (`actions/checkout`), tooling de
 *    workflow, não dependência do produto.
 *
 * Sem este filtro, um projeto npm puro com CI no GitHub detecta três
 * ecossistemas (`npm`, `actions`, `github`), nunca casa com o que a doc declara
 * e sai como `discorda` — um falso positivo no caso MAIS comum, justo no sinal
 * que a fatia existe para tornar confiável.
 */
const NON_STACK_ECOSYSTEMS = new Set(['github', 'githubactions']);

/**
 * Rótulos de stack que aparecem em doc humana e mapeiam para um ecossistema
 * do SBOM. É a ponte que torna o confronto possível: a doc diz "TypeScript",
 * o SBOM diz `npm`. Sem isto, todo projeto "discordaria" de si mesmo.
 *
 * Deliberadamente conservador: só termos inequívocos. Termo desconhecido na
 * doc não vira discordância — vira ausência de sinal (ver `declaredEcosystems`).
 */
const DOC_TERM_TO_ECOSYSTEM: Record<string, string> = {
  typescript: 'npm',
  javascript: 'npm',
  node: 'npm',
  'node.js': 'npm',
  nodejs: 'npm',
  npm: 'npm',
  pnpm: 'npm',
  yarn: 'npm',
  python: 'pip',
  pip: 'pip',
  poetry: 'pip',
  rust: 'cargo',
  cargo: 'cargo',
  go: 'go',
  golang: 'go',
  ruby: 'gem',
  rails: 'gem',
  java: 'maven',
  maven: 'maven',
  gradle: 'maven',
  kotlin: 'maven',
  php: 'composer',
  composer: 'composer',
  'c#': 'nuget',
  csharp: 'nuget',
  dotnet: 'nuget',
  '.net': 'nuget',
  nuget: 'nuget',
  dart: 'pub',
  flutter: 'pub',
  swift: 'swift',
};

/**
 * Extrai `{ecosystem, name}` de um purl SPDX (`pkg:npm/react@18.2.0`).
 * Retorna `null` para referências que não são purl de pacote.
 */
function parsePurl(locator: string): { ecosystem: string; name: string } | null {
  if (!locator.startsWith('pkg:')) return null;
  const rest = locator.slice(4);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const rawEcosystem = rest.slice(0, slash).toLowerCase();
  // Filtra ANTES do alias: a chave de exclusão é o tipo cru do purl.
  if (NON_STACK_ECOSYSTEMS.has(rawEcosystem)) return null;
  // Corta a versão (`@1.2.3`) e a query (`?arch=`) do nome. O `@` de escopo npm
  // (`@nestjs/core`) fica: só o ÚLTIMO `@` delimita versão.
  let name = rest.slice(slash + 1);
  const query = name.indexOf('?');
  if (query >= 0) name = name.slice(0, query);
  const at = name.lastIndexOf('@');
  if (at > 0) name = name.slice(0, at);
  if (!name) return null;
  return {
    ecosystem: ECOSYSTEM_ALIASES[rawEcosystem] ?? rawEcosystem,
    name: decodeURIComponent(name),
  };
}

/**
 * Normaliza a resposta SPDX em `StackDetection`.
 *
 * `null` (negado/404/erro) e SBOM sem pacote nenhum caem no MESMO estado
 * `enabled: false` — decisão da SPEC-023: o usuário não precisa distinguir
 * "desabilitado" de "ativo porém vazio", e ambos exigem o mesmo como-habilitar.
 */
export function normalizeSbom(res: SbomResponse | null): StackDetection {
  const raw = res?.sbom?.packages ?? [];
  const packages: StackPackage[] = [];
  const seen = new Set<string>();

  for (const p of raw) {
    const ref = p.externalRefs?.find(
      (r) => r.referenceType === 'purl' && r.referenceLocator,
    );
    const parsed = ref?.referenceLocator ? parsePurl(ref.referenceLocator) : null;
    if (!parsed) continue;
    const key = `${parsed.ecosystem}/${parsed.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    packages.push({
      ecosystem: parsed.ecosystem,
      name: parsed.name,
      version: p.versionInfo ?? null,
    });
  }

  if (packages.length === 0) {
    return { enabled: false, ecosystems: [], packages: [] };
  }

  const counts = new Map<string, number>();
  for (const p of packages) {
    counts.set(p.ecosystem, (counts.get(p.ecosystem) ?? 0) + 1);
  }
  const ecosystems = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([eco]) => eco);

  return { enabled: true, ecosystems, packages };
}

/**
 * Ecossistemas que a documentação declara, extraídos por casamento de termo
 * conhecido no texto. Reusa o markdown JÁ resolvido (SPEC-023 nota técnica —
 * não cria parser novo de documento).
 *
 * Casa em fronteira de palavra para não achar "go" dentro de "django". Termo
 * fora da tabela é ignorado de propósito: melhor não declarar do que declarar
 * errado e produzir discordância falsa.
 */
export function declaredEcosystems(markdown: string | null): string[] {
  if (!markdown) return [];
  const text = markdown.toLowerCase();
  const found = new Set<string>();
  for (const [term, eco] of Object.entries(DOC_TERM_TO_ECOSYSTEM)) {
    // Escapa `.`, `#`, `+` dos termos (`.net`, `c#`). Fronteira própria em vez
    // de \b: `\b` não funciona ao lado de `#`/`.` (não são caracteres de palavra).
    //
    // As duas bordas são assimétricas de propósito:
    //  - à ESQUERDA, `.` e `#` também barram, senão `.net` casaria dentro de
    //    "asp.net" e `c#` dentro de outro token;
    //  - à DIREITA, só letra/dígito barra. Incluir `.` ali quebrava todo termo
    //    em fim de frase ("Backend em Python." não casava) — e um `.` depois do
    //    termo nunca é ambíguo, porque os termos com ponto começam com ele.
    const escaped = term.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9.#+])${escaped}([^a-z0-9+]|$)`).test(text)) {
      found.add(eco);
    }
  }
  return [...found].sort();
}

/**
 * Confronta declarado × detectado (ADR-018 — coroa nenhuma).
 *
 * Discorda quando os CONJUNTOS diferem em qualquer direção: doc que cita um
 * ecossistema ausente do SBOM e SBOM que traz um ecossistema não citado na doc
 * são, ambos, discordância a mostrar. Qual dos dois está errado não é nosso.
 */
export function compareStack(
  detection: StackDetection,
  declared: string[],
): StackVerdict {
  if (!detection.enabled) return 'nao_detectado';
  if (declared.length === 0) return 'nao_declarado';
  const detected = new Set(detection.ecosystems);
  const doc = new Set(declared);
  if (detected.size !== doc.size) return 'discorda';
  for (const eco of doc) if (!detected.has(eco)) return 'discorda';
  return 'concorda';
}
