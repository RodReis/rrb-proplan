import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

/**
 * O license file — o artefato que o cliente valida **offline** (MVP4 §5).
 *
 * ## A decisão que este arquivo implementa
 *
 * **Validação por assinatura, não por segredo** (MVP4 §1). O servidor assina
 * com a privada Ed25519; o cliente valida com a pública embutida no binário.
 * Consequência prática: o cliente não precisa confiar no relógio do servidor
 * nem manter conexão — a validade offline é `signedAt + graceDays`, e o
 * heartbeat (SPEC-037) só renova `signedAt`.
 *
 * ## Por que `node:crypto` e nenhuma dependência
 *
 * Ed25519 é nativo desde o Node 12 (`sign`/`verify` com chave `ed25519`, sem
 * algoritmo de digest — a curva já define o hash). Uma lib de JWT/JOSE aqui
 * traria negociação de algoritmo, que é superfície de ataque conhecida
 * (`alg: none`, confusão HS256/RS256) para um formato que **não precisa
 * negociar nada**: uma curva, uma chave, um `kid`.
 *
 * ## O contrato é público e estável
 *
 * O War Room implementa o consumidor contra este formato (MVP4 decisão 9).
 * Mudança depois do piloto = `/v2`, nunca quebra do `/v1`. É por isso que
 * `serializePayload` existe separado: a ordem dos campos entra na assinatura,
 * então ela precisa ser **a mesma** dos dois lados, e explícita.
 */

/** 14 dias (MVP4 §5). Favorece o usuário honesto por design. */
export const GRACE_DAYS = 14;

export interface LicensePayload {
  licenseId: string;
  /** Slug da edição (`closed` | `source`), não o id — o cliente lê isto. */
  edition: string;
  billingModel: string;
  /** Opaco para o servidor: só comparado por igualdade. */
  fingerprint: string;
  issuedAt: string;
  updatesUntil: string;
  /** `null` em PERPETUAL. */
  expiresAt: string | null;
  signedAt: string;
  graceDays: number;
  /** Identifica a chave que assinou — o cliente aceita 2 durante rotação. */
  kid: string;
}

export interface LicenseFile {
  payload: LicensePayload;
  /** Ed25519 sobre o `serializePayload`, em base64. */
  signature: string;
}

/**
 * Bytes que a assinatura cobre.
 *
 * `JSON.stringify` de um objeto montado **campo a campo, nesta ordem** — não do
 * payload recebido. A diferença importa: `JSON.stringify` preserva a ordem de
 * inserção, então um payload montado noutra ordem produziria outros bytes e
 * outra assinatura, e a verificação falharia num arquivo legítimo.
 *
 * Fixar a ordem aqui é o que torna o formato reproduzível para quem implementa
 * o cliente noutra linguagem.
 */
export function serializePayload(payload: LicensePayload): Buffer {
  const canonico = {
    licenseId: payload.licenseId,
    edition: payload.edition,
    billingModel: payload.billingModel,
    fingerprint: payload.fingerprint,
    issuedAt: payload.issuedAt,
    updatesUntil: payload.updatesUntil,
    expiresAt: payload.expiresAt,
    signedAt: payload.signedAt,
    graceDays: payload.graceDays,
    kid: payload.kid,
  };
  return Buffer.from(JSON.stringify(canonico), 'utf8');
}

/**
 * Assina o payload. `privateKeyPem` é o conteúdo de `LICENSING_SIGNING_KEY`.
 *
 * O `null` do primeiro argumento de `sign` não é descuido: em Ed25519 o
 * algoritmo de digest **tem de ser** nulo, porque a curva já embute o SHA-512.
 * Passar `'sha256'` ali levanta erro do OpenSSL.
 */
export function signPayload(
  payload: LicensePayload,
  privateKeyPem: string,
): string {
  const key = createPrivateKey(privateKeyPem);
  return sign(null, serializePayload(payload), key).toString('base64');
}

/**
 * Verifica um license file com a chave pública.
 *
 * **O servidor não usa esta função no caminho de emissão** — quem verifica é o
 * cliente. Ela existe aqui porque o critério de aceite pede a conferência da
 * assinatura fora do servidor, e porque um formato de contrato público sem
 * verificador de referência obriga quem implementa o cliente a adivinhar os
 * bytes cobertos.
 *
 * Não lança: entrada corrompida (base64 inválido, chave malformada) é
 * `false`, que é o que "esta assinatura não confere" significa. Distinguir
 * "inválida" de "malformada" só ajudaria quem está sondando o formato.
 */
export function verifyLicenseFile(
  file: LicenseFile,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(
      null,
      serializePayload(file.payload),
      key,
      Buffer.from(file.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/**
 * Monta o payload. Existe separado do `signPayload` para que a **forma** do
 * license file seja testável sem chave nenhuma no ambiente.
 *
 * `signedAt` é o instante da assinatura, e não da emissão: é dele que sai a
 * validade offline (`signedAt + graceDays`), e o heartbeat da SPEC-037 renova
 * exatamente este campo.
 */
export function buildPayload(input: {
  licenseId: string;
  edition: string;
  billingModel: string;
  fingerprint: string;
  issuedAt: Date;
  updatesUntil: Date;
  expiresAt: Date | null;
  kid: string;
  signedAt?: Date;
}): LicensePayload {
  return {
    licenseId: input.licenseId,
    edition: input.edition,
    billingModel: input.billingModel,
    fingerprint: input.fingerprint,
    issuedAt: input.issuedAt.toISOString(),
    updatesUntil: input.updatesUntil.toISOString(),
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    signedAt: (input.signedAt ?? new Date()).toISOString(),
    graceDays: GRACE_DAYS,
    kid: input.kid,
  };
}
