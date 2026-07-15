/**
 * Probe HTTP de URL declarada (SPEC-013.6, ADR-018) — parte PURA e testável.
 *
 * Duas responsabilidades, ambas sem rede:
 *  - `platformFromProbe`: fingerprint determinístico de headers → plataforma.
 *    Nunca chuta: sem fingerprint reconhecido → null.
 *  - `isPublicIp`: classifica um IP já resolvido como público ou não (a guarda 2
 *    do ADR-018). O `HttpProbe` (infra) chama isto sobre o IP que o DNS devolveu,
 *    antes de conectar — e sobre cada redirect. Fail-closed: entrada estranha → false.
 */

import { isIP } from 'node:net';

/**
 * Fingerprint de plataforma a partir dos headers de resposta (chaves em
 * minúsculas assumidas pelo caller; normalizamos por garantia). Ordem de
 * verificação por especificidade — headers próprios antes de `server`.
 */
export function platformFromProbe(
  headers: Record<string, string>,
  _finalUrl: string,
  _bodySlice: string,
): string | null {
  const h = lowerKeys(headers);
  const server = (h['server'] ?? '').toLowerCase();

  // Headers próprios (mais específicos, difíceis de forjar acidentalmente).
  if ('x-vercel-id' in h) return 'vercel';
  if ('x-nf-request-id' in h) return 'netlify';
  if (Object.keys(h).some((k) => k.startsWith('x-railway-'))) return 'railway';
  if ('x-render-origin-server' in h || 'x-render-routing' in h) return 'render';
  if ('fly-request-id' in h) return 'fly';
  if ('cf-ray' in h) return 'cloudflare';

  // `server` por token exato (evita "my-nginx-proxy" virar match acidental).
  const serverTokens = server.split(/[\s/]+/);
  if (serverTokens.includes('vercel')) return 'vercel';
  if (serverTokens.includes('netlify')) return 'netlify';
  if (serverTokens.includes('cloudflare')) return 'cloudflare';
  if (serverTokens.includes('render')) return 'render';

  return null;
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/**
 * O IP resolvido é roteável publicamente? (Guarda 2 do ADR-018.) Rejeita
 * loopback, link-local (incl. o metadata endpoint 169.254.169.254), RFC1918,
 * CGNAT (100.64/10), ULA/loopback IPv6, e IPv4-mapped IPv6 de qualquer um deles.
 * Fail-closed: qualquer coisa não reconhecida como IP público → false.
 */
export function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) return isPublicIpv6(ip);
  return false; // não é IP → fail-closed
}

function isPublicIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;

  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // 10/8 privado
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local (metadata!)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12 privado
  if (a === 192 && b === 168) return false; // 192.168/16 privado
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
  if (a >= 224) return false; // multicast/reservado (224+)
  return true;
}

function isPublicIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped (::ffff:a.b.c.d) — classifica pelo IPv4 embutido.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);

  if (lower === '::1' || lower === '::') return false; // loopback / unspecified
  if (lower.startsWith('fe80')) return false; // link-local fe80::/10
  // ULA fc00::/7 → primeiro byte 0xfc ou 0xfd
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false;
  return true;
}
