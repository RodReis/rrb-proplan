import { platformFromProbe, isPublicIp } from './deploy-probe';

describe('platformFromProbe — fingerprint determinístico', () => {
  it('Vercel: x-vercel-id', () => {
    expect(platformFromProbe({ 'x-vercel-id': 'gru1::abc' }, 'https://x', '')).toBe('vercel');
  });

  it('Vercel: server: Vercel (case-insensitive no valor)', () => {
    expect(platformFromProbe({ server: 'Vercel' }, 'https://x', '')).toBe('vercel');
  });

  it('Netlify: x-nf-request-id', () => {
    expect(platformFromProbe({ 'x-nf-request-id': '01H...' }, 'https://x', '')).toBe('netlify');
  });

  it('Netlify: server: Netlify', () => {
    expect(platformFromProbe({ server: 'Netlify' }, 'https://x', '')).toBe('netlify');
  });

  it('Railway: x-railway-* edge header', () => {
    expect(platformFromProbe({ 'x-railway-request-id': 'r1' }, 'https://x', '')).toBe('railway');
  });

  it('Render: server: render / x-render-*', () => {
    expect(platformFromProbe({ 'x-render-origin-server': 'Render' }, 'https://x', '')).toBe('render');
  });

  it('Fly: fly-request-id', () => {
    expect(platformFromProbe({ 'fly-request-id': 'abc' }, 'https://x', '')).toBe('fly');
  });

  it('Cloudflare: cf-ray', () => {
    expect(platformFromProbe({ 'cf-ray': '80abc' }, 'https://x', '')).toBe('cloudflare');
  });

  it('Cloudflare: server: cloudflare', () => {
    expect(platformFromProbe({ server: 'cloudflare' }, 'https://x', '')).toBe('cloudflare');
  });

  it('headers são tratados case-insensitive na CHAVE', () => {
    expect(platformFromProbe({ 'X-Vercel-Id': 'gru1' }, 'https://x', '')).toBe('vercel');
  });

  it('fingerprint desconhecido → null, NUNCA chuta', () => {
    expect(platformFromProbe({ server: 'nginx' }, 'https://x', '')).toBeNull();
    expect(platformFromProbe({}, 'https://x', '')).toBeNull();
  });

  it('não casa substring acidental (server: "not-vercel-related-app")', () => {
    // "vercel" aparece como substring — o match de server é por token/igualdade,
    // não substring solta. Um server desconhecido não vira vercel.
    expect(platformFromProbe({ server: 'my-nginx-proxy' }, 'https://x', '')).toBeNull();
  });
});

describe('isPublicIp — as guardas de destino do ADR-018', () => {
  it('IPv4 público → true', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('93.184.216.34')).toBe(true);
  });

  it('loopback 127/8 → false', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('127.255.255.255')).toBe(false);
  });

  it('link-local 169.254/16 (metadata endpoint) → false', () => {
    expect(isPublicIp('169.254.169.254')).toBe(false);
    expect(isPublicIp('169.254.0.1')).toBe(false);
  });

  it('RFC1918 privados → false', () => {
    expect(isPublicIp('10.0.0.1')).toBe(false);
    expect(isPublicIp('172.16.0.1')).toBe(false);
    expect(isPublicIp('172.31.255.255')).toBe(false);
    expect(isPublicIp('192.168.1.1')).toBe(false);
  });

  it('172.32.x NÃO é privado (fora do bloco 16-31) → true', () => {
    expect(isPublicIp('172.32.0.1')).toBe(true);
  });

  it('CGNAT 100.64/10 → false', () => {
    expect(isPublicIp('100.64.0.1')).toBe(false);
    expect(isPublicIp('100.127.255.255')).toBe(false);
  });

  it('100.63.x e 100.128.x NÃO são CGNAT → true', () => {
    expect(isPublicIp('100.63.255.255')).toBe(true);
    expect(isPublicIp('100.128.0.1')).toBe(true);
  });

  it('0.0.0.0/8 e broadcast → false', () => {
    expect(isPublicIp('0.0.0.0')).toBe(false);
  });

  it('IPv6 loopback ::1 → false', () => {
    expect(isPublicIp('::1')).toBe(false);
  });

  it('IPv6 link-local fe80::/10 → false', () => {
    expect(isPublicIp('fe80::1')).toBe(false);
  });

  it('IPv6 ULA fc00::/7 → false', () => {
    expect(isPublicIp('fc00::1')).toBe(false);
    expect(isPublicIp('fd12:3456::1')).toBe(false);
  });

  it('IPv6 público → true', () => {
    expect(isPublicIp('2606:4700::1')).toBe(true);
  });

  it('IPv4-mapped IPv6 de endereço privado → false (::ffff:127.0.0.1)', () => {
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIp('::ffff:169.254.169.254')).toBe(false);
  });

  it('string não-IP → false (fail-closed)', () => {
    expect(isPublicIp('não é ip')).toBe(false);
    expect(isPublicIp('')).toBe(false);
  });
});
