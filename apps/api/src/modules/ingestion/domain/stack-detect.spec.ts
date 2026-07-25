import {
  compareStack,
  declaredEcosystems,
  normalizeSbom,
  SbomResponse,
} from './stack-detect';

/** Monta uma resposta SPDX mínima com os purls dados. */
function sbom(...purls: Array<string | [string, string]>): SbomResponse {
  return {
    sbom: {
      packages: purls.map((p) => {
        const [locator, version] = Array.isArray(p) ? p : [p, undefined];
        return {
          name: locator,
          versionInfo: version,
          externalRefs: [{ referenceType: 'purl', referenceLocator: locator }],
        };
      }),
    },
  };
}

describe('normalizeSbom', () => {
  it('extrai ecossistema, nome e versão de purls', () => {
    const d = normalizeSbom(sbom(['pkg:npm/react@18.2.0', '18.2.0']));
    expect(d.enabled).toBe(true);
    expect(d.packages).toEqual([
      { ecosystem: 'npm', name: 'react', version: '18.2.0' },
    ]);
  });

  it('preserva o escopo npm — só o último @ delimita versão', () => {
    const d = normalizeSbom(sbom('pkg:npm/%40nestjs/core@10.0.0'));
    expect(d.packages[0].name).toBe('@nestjs/core');
  });

  it('normaliza aliases de ecossistema do purl', () => {
    const d = normalizeSbom(
      sbom('pkg:golang/gorm.io/gorm@1.25.0', 'pkg:pypi/django@5.0'),
    );
    expect(d.ecosystems.sort()).toEqual(['go', 'pip']);
  });

  it('ordena ecossistemas por nº de pacotes, desc', () => {
    const d = normalizeSbom(
      sbom('pkg:pypi/django@5.0', 'pkg:npm/react@18', 'pkg:npm/vite@5'),
    );
    expect(d.ecosystems).toEqual(['npm', 'pip']);
  });

  it('deduplica o mesmo pacote repetido em manifests diferentes', () => {
    const d = normalizeSbom(sbom('pkg:npm/react@18.2.0', 'pkg:npm/react@18.2.0'));
    expect(d.packages).toHaveLength(1);
  });

  // Regressão de dado REAL: o SBOM de `vercel/swr` (2026-07-25) traz
  // `pkg:github/vercel/swr@main` + `pkg:githubactions/actions/checkout`. Sem
  // filtrar, um projeto npm puro detecta 3 ecossistemas e nunca casa com a doc
  // → `discorda` falso no caso mais comum.
  it('descarta o nó raiz do repo (pkg:github/...)', () => {
    const d = normalizeSbom(
      sbom('pkg:github/vercel/swr@main', 'pkg:npm/react@18'),
    );
    expect(d.ecosystems).toEqual(['npm']);
    expect(d.packages).toHaveLength(1);
  });

  it('descarta passos de CI (pkg:githubactions/...) — não são stack do produto', () => {
    const d = normalizeSbom(
      sbom('pkg:githubactions/actions/checkout@6.0.2', 'pkg:npm/react@18'),
    );
    expect(d.ecosystems).toEqual(['npm']);
  });

  it('repo npm puro com CI no GitHub concorda com doc que diz TypeScript', () => {
    const d = normalizeSbom(
      sbom(
        'pkg:github/vercel/swr@main',
        'pkg:githubactions/actions/checkout@6.0.2',
        'pkg:npm/react@18',
      ),
    );
    expect(compareStack(d, declaredEcosystems('Escrito em TypeScript.'))).toBe(
      'concorda',
    );
  });

  it('SBOM só com ruído (repo raiz + CI) → não habilitado, não stack vazia', () => {
    const d = normalizeSbom(
      sbom('pkg:github/o/r@main', 'pkg:githubactions/actions/checkout@6'),
    );
    expect(d.enabled).toBe(false);
  });

  it('ignora entradas sem purl (o repo raiz vem sem referência)', () => {
    const res: SbomResponse = {
      sbom: { packages: [{ name: 'com.github.owner/repo' }] },
    };
    expect(normalizeSbom(res).enabled).toBe(false);
  });

  // Fallback: negado, vazio e ativo-sem-manifest colapsam no MESMO estado.
  it('trata null (negado/404) como não habilitado', () => {
    expect(normalizeSbom(null)).toEqual({
      enabled: false,
      ecosystems: [],
      packages: [],
    });
  });

  it('trata SBOM sem pacotes como não habilitado', () => {
    expect(normalizeSbom({ sbom: { packages: [] } }).enabled).toBe(false);
  });
});

describe('declaredEcosystems', () => {
  it('mapeia termos da doc para ecossistemas do SBOM', () => {
    expect(declaredEcosystems('Stack: NestJS + TypeScript, Postgres')).toEqual([
      'npm',
    ]);
  });

  it('casa em fronteira de palavra — "go" não casa dentro de "django"', () => {
    expect(declaredEcosystems('Backend em Django')).toEqual([]);
  });

  it('casa termos com pontuação (.net, c#)', () => {
    expect(declaredEcosystems('API em .NET 8')).toEqual(['nuget']);
    expect(declaredEcosystems('Serviço em C# moderno')).toEqual(['nuget']);
  });

  // A borda direita não pode barrar `.`, senão termo em fim de frase some.
  it('casa termo no fim de frase, seguido de ponto', () => {
    expect(declaredEcosystems('Backend em Python.')).toEqual(['pip']);
    expect(declaredEcosystems('Escrito em Go.')).toEqual(['go']);
  });

  it('mas a borda esquerda ainda barra: .net não casa dentro de asp.net', () => {
    // `asp.net` é ASP.NET — casaria `.net`, o que está certo. O que NÃO pode é
    // um termo sem ponto casar colado a outro token: "cargo" em "encargo".
    expect(declaredEcosystems('Cálculo de encargos trabalhistas')).toEqual([]);
  });

  it('deduplica termos que apontam para o mesmo ecossistema', () => {
    expect(declaredEcosystems('TypeScript, Node.js e pnpm')).toEqual(['npm']);
  });

  it('doc sem termo conhecido não declara nada (não inventa)', () => {
    expect(declaredEcosystems('Um sistema de gestão escolar.')).toEqual([]);
  });

  it('doc ausente não declara nada', () => {
    expect(declaredEcosystems(null)).toEqual([]);
  });
});

describe('compareStack (ADR-018 — coroa nenhuma fonte)', () => {
  const npm = normalizeSbom(sbom('pkg:npm/react@18'));
  const off = normalizeSbom(null);

  it('mesmo conjunto → concorda', () => {
    expect(compareStack(npm, ['npm'])).toBe('concorda');
  });

  it('conjuntos diferentes → discorda', () => {
    expect(compareStack(npm, ['pip'])).toBe('discorda');
  });

  it('doc cita ecossistema que o SBOM não detecta → discorda', () => {
    expect(compareStack(npm, ['npm', 'pip'])).toBe('discorda');
  });

  it('SBOM detecta ecossistema que a doc não cita → discorda', () => {
    const dual = normalizeSbom(sbom('pkg:npm/react@18', 'pkg:pypi/django@5'));
    expect(compareStack(dual, ['npm'])).toBe('discorda');
  });

  it('doc não declara → nao_declarado (informação, não erro)', () => {
    expect(compareStack(npm, [])).toBe('nao_declarado');
  });

  // Precedência: DG desabilitado vence a ausência de declaração — não dá para
  // acusar a doc de nada quando não há detecção com que confrontar.
  it('detecção desabilitada → nao_detectado, mesmo sem declaração', () => {
    expect(compareStack(off, [])).toBe('nao_detectado');
    expect(compareStack(off, ['npm'])).toBe('nao_detectado');
  });
});
