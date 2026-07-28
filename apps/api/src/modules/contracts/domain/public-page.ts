import type { ContractLinkStatus } from './contract-token';

/**
 * A página que o cliente abre em `GET /c/:token` (SPEC-034 §2.7, §2.8).
 *
 * ## Página de LEITURA, e isso é escopo
 *
 * **Não há botão "Aceito"** (§2.7): aceite anônimo seria assinatura sem nenhuma
 * garantia de assinatura. Quem registra o aceite é o prestador, no painel
 * (PR-5). Há teste afirmando que não existe `<form>`, `<button>` nem `<input>`
 * nesta página — a ausência é a regra, então é provada por ausência.
 *
 * ## O aviso vem ACIMA do contrato
 *
 * Não é preferência de layout: a SPEC-031 já pagou esse defeito uma vez, com um
 * aviso invisível na etapa 9. O teste afirma a **posição** (índice do aviso <
 * índice do corpo), não a presença — presença é o que passa quando o aviso está
 * no rodapé que ninguém rola até.
 *
 * ## HTML montado à mão, sem template engine
 *
 * Mesma razão do renderizador do PR-3: numa página que serve dado pessoal sem
 * autenticação, a superfície menor ganha. O único dado dinâmico que entra é o
 * `renderedHtml` — que **já foi escapado na emissão** e é imutável. Reescapar
 * aqui transformaria `&amp;` em `&amp;amp;` e faria a página exibir um documento
 * diferente do que foi emitido.
 */

export interface PublicPageInput {
  status: ContractLinkStatus;
  contract?: {
    renderedHtml: string;
    version: number;
    expiresAt: string;
  };
}

/** Mensagem por estado. Nenhuma cita tenant, cliente ou projeto (§5). */
export function statusMessage(status: ContractLinkStatus): string {
  switch (status) {
    case 'expired':
      return 'Este link expirou. Peça um novo a quem o enviou.';
    case 'revoked':
      return 'Este link foi revogado. Peça um novo a quem o enviou.';
    default:
      return 'Este link não é válido. Confira o endereço ou peça um novo a quem o enviou.';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

const ESTILO = `
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 2rem 1rem;
    font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #1a1a1a; background: #f5f5f4;
  }
  main { max-width: 46rem; margin: 0 auto; }
  .aviso {
    border: 1px solid #d97706; background: #fffbeb; color: #78350f;
    border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem;
    font-size: 0.9375rem;
  }
  .aviso strong { display: block; margin-bottom: 0.25rem; }
  .documento {
    background: #fff; border: 1px solid #e7e5e4; border-radius: 8px;
    padding: 2.5rem 3rem;
  }
  .documento h1 { font-size: 1.5rem; margin-top: 0; }
  .documento h2 { font-size: 1.125rem; margin-top: 2rem; }
  .recado { text-align: center; padding: 4rem 1rem; color: #57534e; }
  @media print {
    body { background: #fff; padding: 0; }
    .aviso { display: none; }
    .documento { border: 0; padding: 0; }
  }
`;

function pagina(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
${corpo}
</main>
</body>
</html>`;
}

/**
 * A página completa. Estado que não serve nunca chega a montar o documento —
 * o corpo do contrato só entra no ramo `valid`.
 */
export function renderPublicPage(input: PublicPageInput): string {
  if (input.status !== 'valid' || !input.contract) {
    return pagina(
      'Link indisponível',
      `<div class="recado"><p>${statusMessage(input.status)}</p></div>`,
    );
  }

  const { renderedHtml, expiresAt } = input.contract;

  // O aviso é o primeiro elemento do `main`, antes do documento. A ordem aqui
  // É o critério de aceite — ver o teste de posição.
  return pagina(
    'Contrato',
    `<div class="aviso">
  <strong>Este documento contém dados pessoais das duas partes.</strong>
  Não compartilhe este link. Ele expira em 48 h, no dia ${formatDate(expiresAt)}.
</div>
<article class="documento">
${renderedHtml}
</article>`,
  );
}
