import { API_URL } from '../../lib/api';
import type { Answers, StepAnswers } from './steps';

/**
 * Cliente HTTP da rota pública `/b/:token`.
 *
 * **Não usa o `request()` do `lib/api`** (FIX #136, repetido na nota técnica da
 * SPEC-031): aquele trata 401 como "precisa logar", e quem responde o briefing
 * nunca vai ter conta. `fetch` cru, sem credenciais — cookie de sessão aqui não
 * serviria para nada e só ampliaria a superfície.
 *
 * A outra regra que este arquivo carrega: **429 e 5xx não viram "link
 * inválido"**. Acusar de link ruim um link possivelmente bom manda a pessoa
 * pedir outro sem necessidade.
 */

export type PublicStatus = 'valid' | 'expired' | 'revoked' | 'invalid' | 'submitted';

export interface PublicState {
  status: PublicStatus;
  step?: number;
  answers?: Answers;
  totalSteps?: number;
  completedSteps?: number;
}

export interface Option {
  value: string;
  label: string;
}

export interface Catalog {
  segments: Option[];
  states: Option[];
  services: Record<string, string[]>;
}

/** Erro de campo devolvido pelo 422 do domain. */
export interface FieldError {
  step: number;
  field: string;
  message: string;
}

/** Rede fora ou servidor com problema — distinto de veredito sobre o token. */
export class UnreachableError extends Error {}

/** 422 do domain: a tela mostra o erro no campo, não uma caixa genérica. */
export class ValidationError extends Error {
  constructor(readonly errors: FieldError[]) {
    super('etapa inválida');
  }
}

/** Link deixou de aceitar escrita (revogado/expirado/enviado) — 404 ou 410. */
export class LinkGoneError extends Error {}

function url(token: string, suffix = ''): string {
  return `${API_URL}/b/${encodeURIComponent(token)}${suffix}`;
}

/**
 * Trata a resposta uma vez só, para as três rotas.
 *
 * A distinção entre `LinkGoneError` e `UnreachableError` é o coração daqui: a
 * primeira é veredito do servidor sobre o link, a segunda é "não deu para
 * saber". Confundi-las é exatamente o bug que a nota técnica proíbe.
 */
async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;

  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as {
      message?: { errors?: FieldError[] } | string;
      errors?: FieldError[];
    } | null;
    const errors =
      body?.errors ??
      (typeof body?.message === 'object' ? body.message?.errors : undefined) ??
      [];
    throw new ValidationError(errors);
  }

  if (res.status === 404 || res.status === 410) throw new LinkGoneError();

  // 429 e 5xx caem aqui: não são veredito sobre o token.
  throw new UnreachableError(`HTTP ${res.status}`);
}

const KNOWN_STATUS: readonly PublicStatus[] = [
  'valid',
  'expired',
  'revoked',
  'invalid',
  'submitted',
];

/**
 * Status desconhecido (ou ausente) degrada para `invalid`.
 *
 * A tela indexa uma tabela de textos pelo status — sem esta rede, uma resposta
 * inesperada do servidor viraria tela branca em vez de "confira o link".
 */
function normalizeState(body: PublicState | null): PublicState {
  if (body && KNOWN_STATUS.includes(body.status)) return body;
  return { status: 'invalid' };
}

export async function getState(token: string, signal?: AbortSignal): Promise<PublicState> {
  const res = await fetch(url(token), { signal }).catch(() => {
    throw new UnreachableError('rede indisponível');
  });

  // O GET é a única rota em que 404 é resposta legítima com corpo: o backend
  // devolve `{ status: 'invalid' }` para token inexistente.
  if (res.status === 404) {
    return normalizeState((await res.json().catch(() => null)) as PublicState | null);
  }

  return normalizeState(await parse<PublicState>(res));
}

export async function getCatalog(token: string, signal?: AbortSignal): Promise<Catalog> {
  const res = await fetch(url(token, '/catalog'), { signal }).catch(() => {
    throw new UnreachableError('rede indisponível');
  });
  return parse<Catalog>(res);
}

export async function getCities(
  token: string,
  state: string,
  signal?: AbortSignal,
): Promise<Option[]> {
  const res = await fetch(
    url(token, `/cities/${encodeURIComponent(state)}`),
    { signal },
  ).catch(() => {
    throw new UnreachableError('rede indisponível');
  });
  return parse<Option[]>(res);
}

export interface SaveResult {
  step: number;
  totalSteps: number;
  completedSteps: number;
}

export async function saveDraft(
  token: string,
  step: number,
  answers: StepAnswers,
): Promise<SaveResult> {
  const res = await fetch(url(token, '/draft'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, answers }),
  }).catch(() => {
    throw new UnreachableError('rede indisponível');
  });

  return parse<SaveResult>(res);
}

export interface SubmitResult {
  versionId: string;
  version: number;
  /** `true` quando o reenvio caiu na versão que já existia (idempotência). */
  alreadySubmitted: boolean;
}

/**
 * Envia o briefing (SPEC-031 §5). Idempotente no servidor: clicar duas vezes
 * devolve a mesma versão em vez de criar a segunda.
 */
export async function submitBriefing(token: string): Promise<SubmitResult> {
  const res = await fetch(url(token, '/submit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  }).catch(() => {
    throw new UnreachableError('rede indisponível');
  });

  return parse<SubmitResult>(res);
}

/** Anexo já enviado — metadado, nunca os bytes (SPEC-031 §4). */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
}

/**
 * Upload recusado pelo servidor, com o MOTIVO.
 *
 * Separado de `ValidationError` porque a recusa aqui não é de um campo do
 * formulário: é do arquivo. A tela mostra a mensagem do servidor, que já vem em
 * pt-BR e é a única fonte da verdade sobre o limite — repetir os números na tela
 * criaria dois lugares para mudar quando o ADR-025 for revisto.
 */
export class UploadRejectedError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

/** Limites do ADR-025. Só para avisar ANTES de gastar o upload; a barreira é a API. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 5;

async function parseUpload<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;

  // 413 (grande demais) e 422 (tipo/cota) trazem `{ message, reason }`.
  if (res.status === 413 || res.status === 422) {
    const body = (await res.json().catch(() => null)) as {
      message?: string | { message?: string; reason?: string };
      reason?: string;
    } | null;
    const nested = typeof body?.message === 'object' ? body.message : null;
    const message =
      nested?.message ??
      (typeof body?.message === 'string' ? body.message : undefined) ??
      'arquivo recusado';
    throw new UploadRejectedError(message, nested?.reason ?? body?.reason ?? 'unknown');
  }

  if (res.status === 404 || res.status === 410) throw new LinkGoneError();
  throw new UnreachableError(`HTTP ${res.status}`);
}

export async function listAttachments(
  token: string,
  signal?: AbortSignal,
): Promise<Attachment[]> {
  const res = await fetch(url(token, '/attachments'), { signal }).catch(() => {
    throw new UnreachableError('rede indisponível');
  });
  return parse<Attachment[]>(res);
}

export async function uploadAttachment(
  token: string,
  file: File,
): Promise<Attachment> {
  const form = new FormData();
  form.append('file', file);

  // Sem `Content-Type` manual: o browser precisa gerar o boundary do multipart.
  const res = await fetch(url(token, '/attachments'), {
    method: 'POST',
    body: form,
  }).catch(() => {
    throw new UnreachableError('rede indisponível');
  });

  return parseUpload<Attachment>(res);
}

export async function removeAttachment(token: string, id: string): Promise<void> {
  const res = await fetch(url(token, `/attachments/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  }).catch(() => {
    throw new UnreachableError('rede indisponível');
  });

  // 204 não tem corpo — `parse` tentaria `.json()` e quebraria.
  if (res.ok) return;
  if (res.status === 404 || res.status === 410) throw new LinkGoneError();
  throw new UnreachableError(`HTTP ${res.status}`);
}
