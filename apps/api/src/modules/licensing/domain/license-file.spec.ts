import { generateKeyPairSync } from 'node:crypto';
import {
  GRACE_DAYS,
  buildPayload,
  serializePayload,
  signPayload,
  verifyLicenseFile,
  type LicensePayload,
} from './license-file';

/** Par efêmero, gerado no teste: nenhuma chave real entra no repo. */
function parDeChaves() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const BASE = {
  licenseId: 'lic-1',
  edition: 'closed',
  billingModel: 'PERPETUAL',
  fingerprint: 'fp-abc',
  issuedAt: new Date('2026-07-29T12:00:00Z'),
  updatesUntil: new Date('2027-07-29T12:00:00Z'),
  expiresAt: null,
  kid: '2026-07',
  signedAt: new Date('2026-07-29T12:00:00Z'),
};

describe('SPEC-036: license file assinado', () => {
  describe('buildPayload', () => {
    it('monta os 10 campos do contrato público (MVP4 §5)', () => {
      expect(buildPayload(BASE)).toEqual({
        licenseId: 'lic-1',
        edition: 'closed',
        billingModel: 'PERPETUAL',
        fingerprint: 'fp-abc',
        issuedAt: '2026-07-29T12:00:00.000Z',
        updatesUntil: '2027-07-29T12:00:00.000Z',
        expiresAt: null,
        signedAt: '2026-07-29T12:00:00.000Z',
        graceDays: 14,
        kid: '2026-07',
      });
    });

    it('`expiresAt` é null em PERPETUAL e data em SUBSCRIPTION', () => {
      expect(buildPayload(BASE).expiresAt).toBeNull();
      expect(
        buildPayload({
          ...BASE,
          billingModel: 'SUBSCRIPTION',
          expiresAt: new Date('2026-08-29T12:00:00Z'),
        }).expiresAt,
      ).toBe('2026-08-29T12:00:00.000Z');
    });

    it('a graça é de 14 dias', () => {
      // MVP4 §5: a validade offline é `signedAt + graceDays`. O cliente do War
      // Room depende deste número — mudá-lo é mudar o contrato público.
      expect(GRACE_DAYS).toBe(14);
      expect(buildPayload(BASE).graceDays).toBe(14);
    });

    it('carrega o `kid` da chave vigente', () => {
      // O cliente aceita 2 chaves públicas durante rotação (MVP4 §7) — sem o
      // `kid` ele não saberia com qual verificar.
      expect(buildPayload({ ...BASE, kid: '2027-01' }).kid).toBe('2027-01');
    });
  });

  describe('serializePayload', () => {
    it('fixa a ordem dos campos, não a de inserção do objeto', () => {
      // A ordem entra na assinatura. Um payload montado noutra ordem produziria
      // outros bytes e a verificação falharia num arquivo legítimo — por isso a
      // canonização é explícita, e não `JSON.stringify` do que chegou.
      const normal = buildPayload(BASE);
      const embaralhado = {
        kid: normal.kid,
        graceDays: normal.graceDays,
        signedAt: normal.signedAt,
        expiresAt: normal.expiresAt,
        updatesUntil: normal.updatesUntil,
        issuedAt: normal.issuedAt,
        fingerprint: normal.fingerprint,
        billingModel: normal.billingModel,
        edition: normal.edition,
        licenseId: normal.licenseId,
      } as LicensePayload;

      expect(serializePayload(embaralhado)).toEqual(serializePayload(normal));
    });

    it('é reproduzível — os mesmos bytes para o mesmo payload', () => {
      // Quem implementa o cliente noutra linguagem depende disto.
      const p = buildPayload(BASE);
      expect(serializePayload(p).toString('utf8')).toBe(
        serializePayload(p).toString('utf8'),
      );
    });
  });

  describe('signPayload + verifyLicenseFile', () => {
    it('assinatura gerada pela privada confere com a pública', () => {
      // O critério de aceite da fatia, provado fora do servidor.
      const { priv, pub } = parDeChaves();
      const payload = buildPayload(BASE);
      const file = { payload, signature: signPayload(payload, priv) };

      expect(verifyLicenseFile(file, pub)).toBe(true);
    });

    it('recusa arquivo cujo payload foi adulterado', () => {
      // O cenário real: o comprador edita `updatesUntil` para estender a janela
      // de updates de graça. A assinatura cobre o payload inteiro.
      const { priv, pub } = parDeChaves();
      const payload = buildPayload(BASE);
      const signature = signPayload(payload, priv);

      const adulterado = {
        payload: { ...payload, updatesUntil: '2099-01-01T00:00:00.000Z' },
        signature,
      };
      expect(verifyLicenseFile(adulterado, pub)).toBe(false);
    });

    it('recusa arquivo em que só o fingerprint mudou', () => {
      // Copiar o license file de uma máquina licenciada para outra é a forma
      // mais óbvia de burlar. O `fingerprint` está dentro da assinatura.
      const { priv, pub } = parDeChaves();
      const payload = buildPayload(BASE);
      const file = {
        payload: { ...payload, fingerprint: 'fp-de-outra-maquina' },
        signature: signPayload(payload, priv),
      };
      expect(verifyLicenseFile(file, pub)).toBe(false);
    });

    it('recusa assinatura de OUTRA chave privada', () => {
      // O que sustenta a premissa toda: só quem tem a privada emite arquivo
      // válido. Um par próprio do atacante não passa.
      const { pub } = parDeChaves();
      const outro = parDeChaves();
      const payload = buildPayload(BASE);

      expect(
        verifyLicenseFile({ payload, signature: signPayload(payload, outro.priv) }, pub),
      ).toBe(false);
    });

    it('devolve false, não lança, para entrada corrompida', () => {
      // Distinguir "inválida" de "malformada" só ajudaria quem sonda o formato.
      const { pub } = parDeChaves();
      const payload = buildPayload(BASE);

      expect(verifyLicenseFile({ payload, signature: 'não-é-base64-@@@' }, pub)).toBe(false);
      expect(verifyLicenseFile({ payload, signature: '' }, pub)).toBe(false);
      expect(verifyLicenseFile({ payload, signature: 'AAAA' }, 'chave-inválida')).toBe(false);
    });

    it('a assinatura é base64 e determinística (Ed25519 não é randomizado)', () => {
      const { priv } = parDeChaves();
      const payload = buildPayload(BASE);
      const a = signPayload(payload, priv);

      expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(signPayload(payload, priv)).toBe(a);
    });

    it('o license file não carrega nada do comprador', () => {
      // MVP4 §7: dados pessoais mínimos. O arquivo vai para a máquina do
      // cliente e não precisa de nome nem e-mail para ser validado — a ausência
      // é a proteção, então ela é afirmada.
      const serializado = JSON.stringify(buildPayload(BASE));
      expect(serializado).not.toContain('customerEmail');
      expect(serializado).not.toContain('customerName');
    });
  });
});
