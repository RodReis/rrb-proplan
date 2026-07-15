import { HttpProbe } from './http-probe';

/**
 * Suíte de SEGURANÇA do probe (ADR-018 — critério de aceite, não opcional).
 * As guardas que bloqueiam SSRF são o núcleo. O caminho feliz (fingerprint de
 * plataforma real) é validado no teste ao vivo; aqui provamos que o probe
 * RECUSA tudo que o ADR-018 manda recusar.
 */
describe('HttpProbe — guardas SSRF (ADR-018)', () => {
  const probe = new HttpProbe();

  it('guarda 1: http:// é rejeitado (só https)', async () => {
    const r = await probe.probe('http://example.com');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('esquema_nao_https');
  });

  it('guarda 1: file:// é rejeitado', async () => {
    const r = await probe.probe('file:///etc/passwd');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('esquema_nao_https');
  });

  it('guarda 1: gopher:// é rejeitado', async () => {
    const r = await probe.probe('gopher://evil');
    expect(r.blocked).toBe(true);
  });

  it('guarda 2: host que resolve para loopback (127.0.0.1) → bloqueado, SEM request', async () => {
    // localhost resolve para 127.0.0.1 → não-público → destino_nao_publico.
    const r = await probe.probe('https://localhost/');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('destino_nao_publico');
  });

  it('guarda 2: metadata endpoint 169.254.169.254 → bloqueado', async () => {
    const r = await probe.probe('https://169.254.169.254/latest/meta-data/');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('destino_nao_publico');
  });

  it('guarda 2: IP privado literal 10.0.0.1 → bloqueado', async () => {
    const r = await probe.probe('https://10.0.0.1/');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('destino_nao_publico');
  });

  it('guarda 2: 127.0.0.1 literal → bloqueado', async () => {
    const r = await probe.probe('https://127.0.0.1:9999/');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('destino_nao_publico');
  });

  it('URL malformada → blocked url_invalida (nunca lança)', async () => {
    const r = await probe.probe('não é uma url');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('url_invalida');
  });

  it('guarda 3: redirect para IP interno é bloqueado no salto seguinte', async () => {
    // Duplo de teste: finge que o 1º host é público e responde 302 →
    // https://127.0.0.1/internal. O 2º salto passa pela guarda 2 real
    // (resolvePublicIp de 127.0.0.1 → não-público) e bloqueia. Sem isto, um
    // servidor público poderia redirecionar o probe para dentro da rede.
    class RedirectingProbe extends HttpProbe {
      protected async resolvePublicIps(hostname: string): Promise<string[]> {
        if (hostname === 'safe.example') return ['93.184.216.34']; // finge público
        return super.resolvePublicIps(hostname); // 127.0.0.1 usa a lógica real → []
      }
      protected requestPinned(url: URL): Promise<any> {
        if (url.hostname === 'safe.example') {
          return Promise.resolve({
            kind: 'ok',
            status: 302,
            headers: {},
            location: 'https://127.0.0.1/internal',
            bodySlice: '',
          });
        }
        throw new Error('não deveria alcançar o host interno');
      }
    }
    const r = await new RedirectingProbe().probe('https://safe.example/');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('destino_nao_publico');
  });

  it('guarda 3: redirect que troca para http:// é bloqueado', async () => {
    class DowngradeProbe extends HttpProbe {
      protected async resolvePublicIps(): Promise<string[]> {
        return ['93.184.216.34'];
      }
      protected requestPinned(url: URL): Promise<any> {
        if (url.protocol === 'https:') {
          return Promise.resolve({ kind: 'ok', status: 301, headers: {}, location: 'http://evil.example/', bodySlice: '' });
        }
        throw new Error('não deveria seguir para http');
      }
    }
    const r = await new DowngradeProbe().probe('https://safe.example/');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('esquema_nao_https');
  });

  it('guarda 3: teto de 3 redirects (loop) → excesso_de_redirects', async () => {
    class LoopProbe extends HttpProbe {
      protected async resolvePublicIps(): Promise<string[]> {
        return ['93.184.216.34'];
      }
      protected requestPinned(): Promise<any> {
        return Promise.resolve({ kind: 'ok', status: 302, headers: {}, location: 'https://safe.example/next', bodySlice: '' });
      }
    }
    const r = await new LoopProbe().probe('https://safe.example/');
    expect(r.blocked).toBe(true);
    if (r.blocked) expect(r.reason).toBe('excesso_de_redirects');
  });

  it('caminho feliz: host público responde com fingerprint → não bloqueado', async () => {
    class OkProbe extends HttpProbe {
      protected async resolvePublicIps(): Promise<string[]> {
        return ['93.184.216.34'];
      }
      protected requestPinned(): Promise<any> {
        return Promise.resolve({ kind: 'ok', status: 200, headers: { 'x-vercel-id': 'gru1::abc' }, location: null, bodySlice: '' });
      }
    }
    const r = await new OkProbe().probe('https://foo.example/');
    expect(r.blocked).toBe(false);
    if (!r.blocked) expect(r.headers['x-vercel-id']).toBe('gru1::abc');
  });
});

// Guarda 6 (anonimato — zero credencial): os headers do request são fixos no
// `requestPinned` (só user-agent + accept), nunca recebem token/cookie do
// projeto. Validado por inspeção de código + teste ao vivo (o probe não tem
// acesso a nenhum token — não recebe userId/projectId). Um teste unitário de
// "não contém authorization" sobre o source é frágil e foi removido.

