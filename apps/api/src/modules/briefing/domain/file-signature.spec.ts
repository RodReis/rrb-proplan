import {
  ALLOWED_MIMES,
  MAX_BRIEFING_BYTES,
  MAX_BRIEFING_FILES,
  MAX_FILE_BYTES,
  checkUpload,
  detectMime,
  safeNameFor,
  sanitizeDisplayName,
} from './file-signature';

/**
 * A barreira do upload público (SPEC-031 §4 / ADR-025 item 3).
 *
 * O teste que importa não é "PNG passa" — é **o disfarce não passa**: os casos
 * abaixo mandam bytes hostis com nome e tipo declarados de arquivo inocente,
 * que é exatamente o que um upload sem sessão recebe.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);

const EMPTY_QUOTA = { count: 0, totalBytes: 0 };

describe('detectMime — tipo vem do conteúdo, nunca do que foi declarado', () => {
  it('reconhece os quatro tipos da allowlist', () => {
    expect(detectMime(PNG)).toBe('image/png');
    expect(detectMime(JPEG)).toBe('image/jpeg');
    expect(detectMime(WEBP)).toBe('image/webp');
    expect(detectMime(PDF)).toBe('application/pdf');
  });

  it('recusa executável, ainda que o upload se anuncie como PNG', () => {
    // `MZ` — cabeçalho de PE/EXE. É o caso que o `Content-Type` não pega.
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(detectMime(exe)).toBeNull();
  });

  it('recusa SVG: é XML, executa script e está fora da allowlist', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(detectMime(svg)).toBeNull();
  });

  it('recusa RIFF que não é WebP — .wav tem o mesmo contêiner', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(detectMime(wav)).toBeNull();
  });

  it('recusa arquivo curto demais para carregar a assinatura', () => {
    expect(detectMime(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(detectMime(Buffer.alloc(0))).toBeNull();
  });

  it('não aceita PDF que só tem a assinatura no meio do arquivo', () => {
    // Assinatura fora do offset 0: o conteúdo real é outra coisa.
    const disfarce = Buffer.concat([Buffer.from('AAAA'), Buffer.from('%PDF-')]);
    expect(detectMime(disfarce)).toBeNull();
  });
});

describe('checkUpload — limites duros, aplicados antes de qualquer escrita', () => {
  it('aceita arquivo válido dentro da cota', () => {
    expect(checkUpload(PNG, EMPTY_QUOTA)).toEqual({ ok: true, mime: 'image/png' });
  });

  it('recusa acima de 10 MB por arquivo', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_BYTES)]);
    expect(checkUpload(big, EMPTY_QUOTA)).toEqual({
      ok: false,
      reason: 'file_too_large',
    });
  });

  it('recusa o 6º arquivo do briefing', () => {
    expect(checkUpload(PNG, { count: MAX_BRIEFING_FILES, totalBytes: 100 })).toEqual({
      ok: false,
      reason: 'too_many_files',
    });
  });

  it('recusa quando a soma passa de 25 MB', () => {
    const check = checkUpload(PNG, {
      count: 2,
      totalBytes: MAX_BRIEFING_BYTES - 1,
    });
    expect(check).toEqual({ ok: false, reason: 'briefing_quota_exceeded' });
  });

  it('recusa arquivo vazio', () => {
    expect(checkUpload(Buffer.alloc(0), EMPTY_QUOTA)).toEqual({
      ok: false,
      reason: 'empty_file',
    });
  });

  it('recusa tipo fora da allowlist mesmo dentro de todos os limites', () => {
    const gif = Buffer.from('GIF89a');
    expect(checkUpload(gif, EMPTY_QUOTA)).toEqual({
      ok: false,
      reason: 'mime_not_allowed',
    });
  });

  it('a allowlist tem exatamente os quatro tipos do ADR-025', () => {
    expect([...ALLOWED_MIMES].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});

describe('safeNameFor — nome gerado pelo servidor, nunca derivado do original', () => {
  it('usa a extensão do MIME DETECTADO, não a do nome enviado', () => {
    expect(safeNameFor('abc-123', 'image/png')).toBe('abc-123.png');
    expect(safeNameFor('abc-123', 'image/jpeg')).toBe('abc-123.jpg');
    expect(safeNameFor('abc-123', 'application/pdf')).toBe('abc-123.pdf');
  });
});

describe('sanitizeDisplayName — metadado exibível, não caminho', () => {
  it('mantém nome comum legível', () => {
    expect(sanitizeDisplayName('logo-final-v3.png')).toBe('logo-final-v3.png');
  });

  it('remove separador de caminho e sequência de subida', () => {
    const sujo = sanitizeDisplayName('../../etc/passwd');
    expect(sujo).not.toContain('/');
    expect(sujo).not.toContain('\\');
  });

  it('remove byte de controle e quebra de linha (injeção de header)', () => {
    // Um `\r\n` que sobrevivesse até o `Content-Disposition` partiria o header.
    const sujo = sanitizeDisplayName('nota\r\nX-Injetado: 1.pdf');
    expect(sujo).not.toMatch(/[\r\n]/);
    expect(sujo).toBe('nota X-Injetado: 1.pdf');
  });

  it('corta nome absurdamente longo', () => {
    expect(sanitizeDisplayName('a'.repeat(500))).toHaveLength(120);
  });

  it('nome que vira vazio ganha rótulo, não string vazia', () => {
    expect(sanitizeDisplayName('   ')).toBe('arquivo');
    expect(sanitizeDisplayName('///')).toBe('arquivo');
  });
});
