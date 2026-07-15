import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';
import * as dns from 'node:dns';
import { promisify } from 'node:util';
import { isPublicIp } from '../domain/deploy-probe';

const lookupAll = promisify(dns.lookup) as (
  hostname: string,
  opts: { all: true },
) => Promise<{ address: string; family: number }[]>;

const PROBE_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;

export interface ProbeOk {
  blocked: false;
  headers: Record<string, string>;
  finalUrl: string;
  bodySlice: string;
}
export interface ProbeBlocked {
  blocked: true;
  reason: string;
}
export type ProbeResult = ProbeOk | ProbeBlocked;

/**
 * Fetch endurecido SSRF-safe (SPEC-013.6, ADR-018) — as 7 guardas, todas aqui:
 *  1. Só https (rejeita http/file/etc).
 *  2. Resolve o DNS e rejeita destino não-público (isPublicIp), ANTES de conectar.
 *  3. Re-valida cada redirect (teto 3), sem troca de esquema.
 *  4. HEAD→GET, corpo ≤64KB, timeout ~5s.
 *  5. Só URLs de deploy.prodUrls (responsabilidade do caller; aqui nunca é URL arbitrária).
 *  6. Zero credencial (nenhum header de auth/cookie é setado).
 *  7. Devolve só headers/finalUrl/bodySlice — persistência do corpo é proibida ao caller.
 *
 * DNS rebinding fechado por **pin**: resolvemos e validamos o IP uma vez e
 * passamos um `lookup` custom ao https.request que devolve exatamente aquele IP
 * — o socket conecta no IP validado, não numa re-resolução.
 */
@Injectable()
export class HttpProbe {
  private readonly logger = new Logger(HttpProbe.name);

  async probe(rawUrl: string): Promise<ProbeResult> {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let url: URL;
      try {
        url = new URL(current);
      } catch {
        return { blocked: true, reason: 'url_invalida' };
      }

      // Guarda 1 — só https.
      if (url.protocol !== 'https:') {
        return { blocked: true, reason: 'esquema_nao_https' };
      }

      // Guarda 2 — resolve e valida os IPs; só os públicos entram (fail-closed).
      const publicIps = await this.resolvePublicIps(url.hostname);
      if (publicIps.length === 0) {
        return { blocked: true, reason: 'destino_nao_publico' };
      }

      // Tenta cada IP público validado (pinado) até um conectar — cobre host
      // com IPv6 sem rota de saída + IPv4 (Happy-Eyeballs simplificado). Cada
      // tentativa conecta EXATAMENTE no IP já validado, então o rebinding segue
      // fechado. Só erro de conexão faz cair para o próximo; qualquer resposta
      // (inclusive redirect) encerra a tentativa.
      let res: Awaited<ReturnType<typeof this.requestPinned>> | null = null;
      for (const ip of publicIps) {
        res = await this.requestPinned(url, ip, hop === 0 ? 'HEAD' : 'GET');
        if (res.kind === 'ok') break;
      }
      if (!res || res.kind === 'error') {
        return { blocked: true, reason: res?.reason ?? 'erro_de_rede' };
      }

      // Guarda 3 — redirect: re-valida no próximo laço (mesma checagem de IP).
      if (res.location && res.status >= 300 && res.status < 400) {
        if (hop === MAX_REDIRECTS) {
          return { blocked: true, reason: 'excesso_de_redirects' };
        }
        // Resolve relativo à URL atual; o próximo laço revalida esquema+IP.
        try {
          current = new URL(res.location, url).toString();
        } catch {
          return { blocked: true, reason: 'location_invalido' };
        }
        continue;
      }

      // HEAD não trouxe corpo útil de fingerprint? Os headers bastam para o
      // fingerprint (x-vercel-id, server, cf-ray...). Fazemos um GET leve só se
      // o HEAD veio sem nenhum header candidato — mas os headers de plataforma
      // vêm no HEAD, então HEAD já resolve. Retornamos com o que temos.
      return {
        blocked: false,
        headers: res.headers,
        finalUrl: url.toString(),
        bodySlice: res.bodySlice,
      };
    }
    return { blocked: true, reason: 'excesso_de_redirects' };
  }

  /** Resolve o hostname e devolve os IPs PÚBLICOS validados, IPv4 antes de IPv6
   *  (conectividade: muitos ambientes não têm rota IPv6 de saída). Lista vazia =
   *  nenhum IP público → bloqueado. `protected` para o duplo de teste da cadeia
   *  de redirect (a guarda 3 é critério de aceite do ADR-018). */
  protected async resolvePublicIps(hostname: string): Promise<string[]> {
    let addrs: { address: string; family: number }[];
    try {
      addrs = await lookupAll(hostname, { all: true });
    } catch {
      return []; // DNS falhou → trata como não-sondável
    }
    const publics = addrs.filter((a) => isPublicIp(a.address));
    // IPv4 primeiro; qualquer IP não-público já foi descartado (fail-closed).
    publics.sort((a, b) => a.family - b.family);
    return publics.map((a) => a.address);
  }

  /**
   * Faz a request conectando no IP PINADO (lookup custom devolve só ele) —
   * fecha a janela de DNS rebinding. Host header preservado (SNI/vhost corretos).
   * Zero credencial. Corpo lido com teto rígido.
   */
  protected requestPinned(
    url: URL,
    pinnedIp: string,
    method: 'HEAD' | 'GET',
  ): Promise<
    | { kind: 'ok'; status: number; headers: Record<string, string>; location: string | null; bodySlice: string }
    | { kind: 'error'; reason: string }
  > {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r: Parameters<typeof resolve>[0]) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const req = https.request(
        {
          protocol: 'https:',
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method,
          // Pin: o socket resolve o host para o IP já validado, sempre. O Node
          // pode chamar com `opts.all` — respeitamos os dois formatos de callback.
          lookup: (_host: string, opts: any, cb: any) => {
            const family = isIpFamily(pinnedIp);
            if (opts && opts.all) cb(null, [{ address: pinnedIp, family }]);
            else cb(null, pinnedIp, family);
          },
          headers: {
            // Guarda 6 — anônimo. Só um UA neutro; nenhum auth/cookie.
            'user-agent': 'rrb-proplan-deploy-probe',
            accept: '*/*',
          },
          timeout: PROBE_TIMEOUT_MS,
        },
        (res) => {
          const headers = flattenHeaders(res.headers);
          const status = res.statusCode ?? 0;
          const location = typeof res.headers.location === 'string' ? res.headers.location : null;

          if (method === 'HEAD') {
            res.resume(); // descarta qualquer corpo
            done({ kind: 'ok', status, headers, location, bodySlice: '' });
            return;
          }
          // GET: lê no máximo MAX_BODY_BYTES, aborta o resto.
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            if (size < MAX_BODY_BYTES) {
              chunks.push(c);
              size += c.length;
              if (size >= MAX_BODY_BYTES) res.destroy();
            }
          });
          res.on('end', () =>
            done({
              kind: 'ok',
              status,
              headers,
              location,
              bodySlice: Buffer.concat(chunks).toString('utf-8').slice(0, MAX_BODY_BYTES),
            }),
          );
          res.on('close', () =>
            done({
              kind: 'ok',
              status,
              headers,
              location,
              bodySlice: Buffer.concat(chunks).toString('utf-8').slice(0, MAX_BODY_BYTES),
            }),
          );
        },
      );

      req.on('timeout', () => {
        req.destroy();
        done({ kind: 'error', reason: 'timeout' });
      });
      req.on('error', () => done({ kind: 'error', reason: 'erro_de_rede' }));
      req.end();
    });
  }
}

function isIpFamily(ip: string): 4 | 6 {
  return ip.includes(':') ? 6 : 4;
}

function flattenHeaders(h: NodeJS.Dict<string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}
