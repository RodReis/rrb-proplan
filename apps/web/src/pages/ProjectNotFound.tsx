import { Link } from 'react-router-dom';

/**
 * URL de projeto inexistente ou removido (SPEC-020 §6).
 *
 * Acontece de verdade: desgerenciar um projeto aberto em outra aba e recarregar
 * cai aqui. Não é falha — é um projeto que deixou de ser gerenciado —, então
 * nada de cor de erro (§1: cor só carrega significado).
 */
export function ProjectNotFound() {
  return (
    <div className="flex h-screen items-center justify-center bg-bg p-8">
      <div className="w-full max-w-md rounded-2xl border border-border2 bg-surface p-8 text-center">
        <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          Projeto não encontrado
        </div>
        <h1 className="text-xl font-semibold text-text">
          Este projeto não está mais gerenciado
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-body">
          Ele pode ter sido removido do catálogo, ou o link está desatualizado. O
          repositório no GitHub não foi tocado.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-btnbg px-4 text-sm font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
        >
          Voltar ao catálogo
        </Link>
      </div>
    </div>
  );
}
