import { generateKeyPairSync } from 'node:crypto';
import { verifyLicenseFile } from '../domain/license-file';
import { LicenseSigningService } from './license-signing.service';

/** Par efêmero: nenhuma chave real entra no repo nem no ambiente de teste. */
function parDeChaves() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const ENTRADA = {
  licenseId: 'lic-1',
  edition: 'closed',
  billingModel: 'PERPETUAL',
  fingerprint: 'fp-abc',
  issuedAt: new Date('2026-07-29T12:00:00Z'),
  updatesUntil: new Date('2027-07-29T12:00:00Z'),
  expiresAt: null,
};

describe('SPEC-036: assinatura do license file', () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
  });

  it('assina com a chave do ambiente e o arquivo confere com a pública', () => {
    const { priv, pub } = parDeChaves();
    process.env.LICENSING_SIGNING_KEY = priv;
    process.env.LICENSING_SIGNING_KID = '2026-07';

    const file = new LicenseSigningService().sign(ENTRADA);

    expect(verifyLicenseFile(file, pub)).toBe(true);
    expect(file.payload.kid).toBe('2026-07');
  });

  it('aceita o PEM em base64 (formato de secret desta casa)', () => {
    // O mesmo formato que `GITHUB_APP_PRIVATE_KEY` já usa: PEM tem quebras de
    // linha e secret de Railway guarda uma linha só. Sem isto, a assinatura
    // falharia só em produção.
    const { priv, pub } = parDeChaves();
    process.env.LICENSING_SIGNING_KEY = Buffer.from(priv, 'utf8').toString('base64');
    process.env.LICENSING_SIGNING_KID = '2026-07';

    expect(verifyLicenseFile(new LicenseSigningService().sign(ENTRADA), pub)).toBe(true);
  });

  it('aceita PEM com `\\n` literal — o outro jeito comum de colar', () => {
    // Recusá-lo daria "assinatura indisponível" para uma chave que está lá.
    const { priv, pub } = parDeChaves();
    process.env.LICENSING_SIGNING_KEY = priv.replace(/\n/g, '\\n');
    process.env.LICENSING_SIGNING_KID = '2026-07';

    expect(verifyLicenseFile(new LicenseSigningService().sign(ENTRADA), pub)).toBe(true);
  });

  it('chave ilegível é tratada como ausente, não como erro de OpenSSL', () => {
    // Base64 que não decodifica para PEM: 503, a mesma resposta de chave
    // ausente. Um erro cru de OpenSSL vazaria formato interno na resposta.
    process.env.LICENSING_SIGNING_KEY = 'isto-não-é-chave-nenhuma';
    process.env.LICENSING_SIGNING_KID = '2026-07';

    const service = new LicenseSigningService();
    expect(service.isConfigured).toBe(false);
    expect(() => service.sign(ENTRADA)).toThrow(/indisponível/i);
  });

  it.each([
    ['sem chave', { LICENSING_SIGNING_KID: '2026-07' }],
    ['sem kid', { LICENSING_SIGNING_KEY: 'x' }],
    ['sem nenhum dos dois', {}],
  ])('%s: falha com 503 em vez de emitir arquivo sem assinatura', (_caso, env) => {
    // A alternativa — devolver um arquivo sem assinatura, ou assinado com uma
    // chave gerada na hora — produziria arquivos que nenhum cliente valida, e o
    // comprador descobriria isso ao abrir o produto, não aqui.
    delete process.env.LICENSING_SIGNING_KEY;
    delete process.env.LICENSING_SIGNING_KID;
    Object.assign(process.env, env);

    expect(() => new LicenseSigningService().sign(ENTRADA)).toThrow(
      /indisponível/i,
    );
  });

  it('o erro não revela o nome da variável de ambiente', () => {
    // O operador precisa saber o que configurar (vai no log); quem chama a
    // rota não precisa saber como o servidor guarda segredo.
    delete process.env.LICENSING_SIGNING_KEY;
    delete process.env.LICENSING_SIGNING_KID;

    try {
      new LicenseSigningService().sign(ENTRADA);
      throw new Error('deveria ter falhado');
    } catch (erro) {
      expect((erro as Error).message).not.toContain('LICENSING_SIGNING_KEY');
    }
  });

  it('`isConfigured` responde sem tentar assinar', () => {
    // A tela usa isto para avisar ANTES de alguém emitir e entregar uma chave
    // que não ativa.
    delete process.env.LICENSING_SIGNING_KEY;
    delete process.env.LICENSING_SIGNING_KID;
    expect(new LicenseSigningService().isConfigured).toBe(false);

    const { priv } = parDeChaves();
    process.env.LICENSING_SIGNING_KEY = priv;
    process.env.LICENSING_SIGNING_KID = '2026-07';
    expect(new LicenseSigningService().isConfigured).toBe(true);
  });

  it('lê a chave a cada chamada — rotação não exige redeploy', () => {
    const primeiro = parDeChaves();
    const segundo = parDeChaves();
    process.env.LICENSING_SIGNING_KEY = primeiro.priv;
    process.env.LICENSING_SIGNING_KID = '2026-07';

    const service = new LicenseSigningService();
    expect(verifyLicenseFile(service.sign(ENTRADA), primeiro.pub)).toBe(true);

    process.env.LICENSING_SIGNING_KEY = segundo.priv;
    process.env.LICENSING_SIGNING_KID = '2027-01';

    const depois = service.sign(ENTRADA);
    expect(depois.payload.kid).toBe('2027-01');
    expect(verifyLicenseFile(depois, segundo.pub)).toBe(true);
    // E o arquivo novo NÃO valida com a pública antiga — é o `kid` que diz ao
    // cliente qual das duas usar durante a rotação.
    expect(verifyLicenseFile(depois, primeiro.pub)).toBe(false);
  });

  it('o `fingerprint` recebido viaja no payload assinado', () => {
    // Critério de aceite: `payload.fingerprint` = fingerprint enviado. É o que
    // impede copiar o arquivo de uma máquina licenciada para outra.
    const { priv } = parDeChaves();
    process.env.LICENSING_SIGNING_KEY = priv;
    process.env.LICENSING_SIGNING_KID = '2026-07';

    const file = new LicenseSigningService().sign({
      ...ENTRADA,
      fingerprint: 'fp-da-maquina-do-comprador',
    });
    expect(file.payload.fingerprint).toBe('fp-da-maquina-do-comprador');
  });
});
