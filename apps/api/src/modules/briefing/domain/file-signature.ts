/**
 * Allowlist de anexo e verificação de tipo **pelo conteúdo** (SPEC-031 §4,
 * ADR-025 item 3).
 *
 * Regra de negócio PURA — sem Prisma, sem HTTP, sem Nest. É a barreira do
 * upload público, a superfície mais exposta do produto: quem sobe o arquivo não
 * tem conta, não passa por guard nenhum e escolhe cada byte que chega aqui.
 *
 * A decisão que este módulo executa: **o `Content-Type` do request e a extensão
 * do nome não são evidência de nada**. Ambos são escritos por quem envia. Um
 * `.png` que começa com `MZ` é um executável com nome de imagem; um
 * `Content-Type: image/png` num `.svg` é um vetor com `<script>` dentro. O que
 * decide é a assinatura dos primeiros bytes — o único campo do upload que o
 * atacante não controla sem trocar o arquivo de verdade.
 *
 * SVG está fora da allowlist de propósito: é XML, executa script, e não tem
 * assinatura de bytes que o distinga de um documento hostil.
 */

/** 10 MB por arquivo (ADR-025). Subir daqui dispara o gatilho de revisão. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 25 MB somados por briefing. */
export const MAX_BRIEFING_BYTES = 25 * 1024 * 1024;
/** 5 arquivos por briefing. */
export const MAX_BRIEFING_FILES = 5;

export type AllowedMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'application/pdf';

export const ALLOWED_MIMES: readonly AllowedMime[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
];

/** Extensão canônica — gerada pelo servidor a partir do MIME DETECTADO. */
const EXTENSION: Record<AllowedMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

interface Signature {
  mime: AllowedMime;
  /** Bytes esperados a partir de `offset`. `null` = qualquer byte (curinga). */
  magic: readonly (number | null)[];
  offset: number;
}

/**
 * Assinaturas dos quatro tipos aceitos.
 *
 * WebP é o único que precisa de duas janelas: o contêiner RIFF (bytes 0-3) diz
 * "é um RIFF", e só o `WEBP` no byte 8 distingue de um `.wav` ou `.avi`, que
 * são RIFF também. Verificar só o `RIFF` aceitaria áudio com nome de imagem.
 */
const SIGNATURES: readonly Signature[] = [
  // \x89 P N G \r \n \x1a \n
  { mime: 'image/png', offset: 0, magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG SOI + marcador. O terceiro byte varia (0xE0 JFIF, 0xE1 Exif, 0xDB...).
  { mime: 'image/jpeg', offset: 0, magic: [0xff, 0xd8, 0xff] },
  // R I F F ? ? ? ? W E B P
  {
    mime: 'image/webp',
    offset: 0,
    magic: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
  // % P D F -
  { mime: 'application/pdf', offset: 0, magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/**
 * MIME real do buffer, ou `null` quando nenhuma assinatura da allowlist bate.
 *
 * `null` significa **recusa**, não "desconhecido, deixa passar": a lista é
 * fechada e o que não está nela não entra.
 */
export function detectMime(bytes: Buffer): AllowedMime | null {
  for (const sig of SIGNATURES) {
    if (matches(bytes, sig)) return sig.mime;
  }
  return null;
}

function matches(bytes: Buffer, sig: Signature): boolean {
  if (bytes.length < sig.offset + sig.magic.length) return false;
  return sig.magic.every(
    (expected, i) => expected === null || bytes[sig.offset + i] === expected,
  );
}

/**
 * Nome seguro gerado pelo servidor (spec §4).
 *
 * Nunca derivado do nome original: aquele é metadado exibível e só isso.
 * Traçado por `id` + extensão do MIME **detectado** — sem separador de caminho,
 * sem `..`, sem caractere que signifique algo para um filesystem ou uma URL. Os
 * bytes vivem no Postgres e não há caminho para atravessar, mas o nome viaja no
 * `Content-Disposition` do download, e é lá que ele volta a ser perigoso.
 */
export function safeNameFor(id: string, mime: AllowedMime): string {
  return `${id}.${EXTENSION[mime]}`;
}

/**
 * Nome original, saneado para EXIBIÇÃO.
 *
 * Guardar o que o cliente digitou é útil ("logo-final-v3.png" diz mais que um
 * uuid), mas ele acaba renderizado numa tela do prestador. Tiramos controle,
 * quebra de linha e separador de caminho, e cortamos o comprimento — o resto é
 * texto, e a tela escapa o que renderiza.
 */
export function sanitizeDisplayName(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- tirar byte de controle É o ponto
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    // Separador de caminho vira espaço: o nome viaja no `Content-Disposition`.
    .replace(/[/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned === '' ? 'arquivo' : cleaned;
}

export type RejectionReason =
  | 'file_too_large'
  | 'briefing_quota_exceeded'
  | 'too_many_files'
  | 'mime_not_allowed'
  | 'empty_file';

export type UploadCheck =
  | { ok: true; mime: AllowedMime }
  | { ok: false; reason: RejectionReason };

/**
 * Decide se o upload entra. Chamado ANTES de qualquer escrita: recusado, nada
 * é gravado (ADR-025 item 3).
 *
 * A ordem importa pouco para a corretude e muito para a mensagem: o teto por
 * arquivo é checado antes da cota do briefing porque "seu arquivo tem 40 MB" é
 * mais acionável que "o briefing estourou 25 MB".
 */
export function checkUpload(
  bytes: Buffer,
  existing: { count: number; totalBytes: number },
): UploadCheck {
  if (bytes.length === 0) return { ok: false, reason: 'empty_file' };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, reason: 'file_too_large' };
  if (existing.count >= MAX_BRIEFING_FILES) {
    return { ok: false, reason: 'too_many_files' };
  }
  if (existing.totalBytes + bytes.length > MAX_BRIEFING_BYTES) {
    return { ok: false, reason: 'briefing_quota_exceeded' };
  }

  const mime = detectMime(bytes);
  if (mime === null) return { ok: false, reason: 'mime_not_allowed' };

  return { ok: true, mime };
}

/** Mensagem em pt-BR para o 422 — a tela mostra o texto do servidor. */
export const REJECTION_MESSAGE: Record<RejectionReason, string> = {
  empty_file: 'arquivo vazio',
  file_too_large: 'arquivo acima de 10 MB',
  briefing_quota_exceeded: 'limite de 25 MB por briefing atingido',
  too_many_files: 'limite de 5 arquivos por briefing atingido',
  mime_not_allowed: 'tipo não aceito — envie PNG, JPEG, WebP ou PDF',
};
