import { useState } from 'react';
import { api, StackBlock, StackPackage } from '../../lib/api';

/**
 * Bloco "Stack detectada" (SPEC-023) na aba Arquitetura.
 *
 * Duas regras que este componente existe para não quebrar:
 *  1. **Coroa nenhuma fonte** (ADR-018). Discordância mostra declarado e
 *     detectado lado a lado. Nenhum rótulo de "correto"/"errado" em nenhum lado.
 *  2. **Proveniência visível** (ADR-012). O selo `detectado do manifest` marca a
 *     origem `sbom` — não é o dono que declarou, não é IA que inferiu.
 */

const ECOSYSTEM_LABEL: Record<string, string> = {
  npm: 'npm (JavaScript/TypeScript)',
  pip: 'pip (Python)',
  cargo: 'cargo (Rust)',
  go: 'Go modules',
  gem: 'RubyGems',
  maven: 'Maven (Java/Kotlin)',
  composer: 'Composer (PHP)',
  nuget: 'NuGet (.NET)',
  pub: 'pub (Dart/Flutter)',
  swift: 'Swift Package Manager',
};

function label(eco: string): string {
  return ECOSYSTEM_LABEL[eco] ?? eco;
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'data desconhecida';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Estado de fallback: Dependency Graph desabilitado, negado ou repo sem
 * manifests — colapsados de propósito (o usuário não precisa distinguir, e a
 * ação é a mesma). Visualmente distinto de "ainda não sincronizado": este bloco
 * só renderiza depois de uma coleta, e o texto diz o que habilitar.
 */
function NotEnabled({ observedAt }: { observedAt: string | null }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-medium">Stack detectada</h2>
      <p className="mb-2 text-sm text-muted">
        O Dependency Graph não está habilitado neste repositório, ou ele não tem
        manifests de dependência reconhecidos.
      </p>
      <p className="text-xs text-muted">
        Para habilitar: <span className="font-medium">Settings → Security → Code
        security and analysis → Dependency graph</span>. Em repositório privado ele
        vem desabilitado por padrão. Verificado em {fmtDate(observedAt)}.
      </p>
    </section>
  );
}

/** Uma coluna do confronto: o rótulo da fonte + os ecossistemas que ela aponta. */
function Side({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {items.map((e) => (
            <li key={e}>{label(e)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Faixa do confronto. Só `discorda` ganha destaque de atenção — concordância é
 * reforço discreto e ausência de declaração é informação neutra, nunca alarme.
 */
function Verdict({ stack }: { stack: StackBlock }) {
  const stamp = `observado em ${fmtDate(stack.observedAt)}`;

  if (stack.verdict === 'discorda') {
    return (
      <div className="mt-3 rounded-md border border-error/40 bg-error/5 p-3">
        <p className="mb-1 flex items-center gap-2 text-sm font-medium text-error">
          <span aria-hidden>🔴</span> A documentação e os manifests discordam sobre a stack
        </p>
        <p className="mb-3 text-xs text-muted">
          O ProPlan não afirma qual está certa — mostra as duas fontes com sua
          natureza e data ({stamp}).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Side
            title="declarado na documentação"
            items={stack.declared}
            empty="nada declarado"
          />
          <Side
            title="detectado nos manifests"
            items={stack.ecosystems}
            empty="nada detectado"
          />
        </div>
      </div>
    );
  }

  if (stack.verdict === 'concorda') {
    return (
      <p className="mt-2 text-xs text-muted">
        ✓ A documentação declara a mesma stack que os manifests apontam ({stamp}).
      </p>
    );
  }

  // `nao_declarado`: ausência é informação, não erro (ADR-014). Sem ícone de
  // alerta, sem cor de erro — a doc não é obrigada a declarar stack.
  return (
    <p className="mt-2 text-xs text-muted">
      A documentação não declara a stack; o detectado aparece sozinho ({stamp}).
    </p>
  );
}

/** Lista de dependências, buscada só ao expandir (critério de aceite SPEC-023). */
function PackageList({ projectId, count }: { projectId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [packages, setPackages] = useState<StackPackage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca no clique, não em efeito: é o próprio ato de expandir que autoriza a
  // request. Um useEffect com `open` na dep faria a mesma coisa com um render a
  // mais e uma corrida a gerenciar.
  function expand() {
    setOpen(true);
    if (packages || loading) return;
    setLoading(true);
    setError(null);
    api
      .stackPackages(projectId)
      .then((res) => setPackages(res.packages))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }

  if (!open) {
    return (
      <button
        onClick={expand}
        className="mt-3 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        Ver as {count} dependências detectadas
      </button>
    );
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(false)}
        className="mb-2 text-xs font-semibold text-muted hover:text-brand"
      >
        Ocultar dependências
      </button>
      {loading && <p className="text-sm text-muted">Carregando…</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      {packages && (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto text-sm">
          {packages.map((p) => (
            <li key={`${p.ecosystem}/${p.name}`} className="flex flex-wrap gap-x-2">
              <span className="text-xs text-muted">{p.ecosystem}</span>
              <span>{p.name}</span>
              {p.version && <span className="text-xs text-muted">{p.version}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StackPanel({ projectId, stack }: { projectId: string; stack: StackBlock }) {
  if (!stack.enabled) return <NotEnabled observedAt={stack.observedAt} />;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Stack detectada</h2>
        {/* Proveniência (ADR-012): distingue de stack declarada e de IA. */}
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
          detectado do manifest pelo GitHub
        </span>
      </div>

      <ul className="flex flex-wrap gap-2">
        {stack.ecosystems.map((e) => (
          <li key={e} className="rounded-md border border-border px-2 py-0.5 text-sm">
            {label(e)}
          </li>
        ))}
      </ul>

      <Verdict stack={stack} />

      {stack.sourceSha && (
        <p className="mt-2 text-xs text-muted">
          ancorado ao commit <code>{stack.sourceSha.slice(0, 7)}</code> do branch padrão
        </p>
      )}

      {stack.packageCount > 0 && (
        <PackageList projectId={projectId} count={stack.packageCount} />
      )}
    </section>
  );
}
