import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  privateDecrypt,
  timingSafeEqual,
  type CipherGCMTypes,
} from 'crypto';

/**
 * Cifrado del endpoint de WhatsApp Flows.
 *
 * Meta usa un esquema híbrido por petición:
 *
 * 1. Genera una clave AES nueva y la cifra con nuestra clave pública RSA
 *    (OAEP con SHA-256) → `encrypted_aes_key`.
 * 2. Cifra el cuerpo con AES-GCM usando esa clave y un IV → `encrypted_flow_data`,
 *    con el tag de autenticación pegado al final del ciphertext.
 * 3. Espera la respuesta cifrada con **la misma clave AES** y el **IV invertido**
 *    (cada byte XOR 0xFF), en base64 y como texto plano, no como JSON.
 *
 * Reusar la clave e invertir el IV no es una elección nuestra: es el contrato de
 * Meta. Cifrar la respuesta con el IV original reutilizaría el par (clave, IV) de
 * AES-GCM, que es exactamente lo que ese modo no admite.
 */

/** Longitud del tag de autenticación de AES-GCM, en bytes. */
const AUTH_TAG_LENGTH = 16;

/**
 * Normaliza la clave privada leída de una variable de entorno.
 *
 * Un PEM tiene saltos de línea reales, y las plataformas de deploy los maltratan
 * de formas distintas: algunas guardan `\n` literal de dos caracteres, y mucha
 * gente termina pegando el PEM en base64 para esquivar el problema. Node no
 * acepta ninguna de las dos variantes y falla con un error opaco de descifrado
 * que se lee como "clave equivocada", no como "formato equivocado".
 *
 * Aceptar las tres formas cuesta diez líneas y evita esa sesión de depuración.
 */
export function normalizePrivateKeyPem(raw: string): string {
  const trimmed = raw.trim();

  // Base64 del PEM completo: ni siquiera contiene la cabecera en claro.
  if (!trimmed.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
      if (decoded.includes('-----BEGIN')) return decoded.trim();
    } catch {
      // Se devuelve tal cual y que falle el descifrado con su propio error.
    }
    return trimmed;
  }

  // PEM con `\n` literales en lugar de saltos reales. Se vuelve a recortar
  // porque al desescapar puede aparecer un salto final.
  return trimmed.includes('\\n')
    ? trimmed.replace(/\\n/g, '\n').trim()
    : trimmed;
}

export class FlowDecryptionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FlowDecryptionError';
  }
}

/** Cuerpo cifrado tal como llega desde Meta. */
export type EncryptedFlowRequest = {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
};

export type DecryptedFlowRequest = {
  /** Payload ya parseado. */
  body: Record<string, unknown>;
  /**
   * Clave AES e IV de esta petición. Hay que conservarlos para poder cifrar la
   * respuesta: son de un solo uso y Meta no los vuelve a enviar.
   */
  aesKey: Buffer;
  initialVector: Buffer;
};

export function isEncryptedFlowRequest(
  value: unknown,
): value is EncryptedFlowRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.encrypted_flow_data === 'string' &&
    typeof candidate.encrypted_aes_key === 'string' &&
    typeof candidate.initial_vector === 'string'
  );
}

/**
 * Descifra una petición del endpoint.
 *
 * Lanza `FlowDecryptionError` ante cualquier fallo. El llamador debe responder
 * HTTP 421 en ese caso: es la señal con la que Meta entiende que debe volver a
 * pedir la clave pública, en lugar de dar el Flow por roto.
 */
export function decryptFlowRequest(params: {
  request: EncryptedFlowRequest;
  privateKeyPem: string;
  privateKeyPassphrase?: string;
}): DecryptedFlowRequest {
  const { request, privateKeyPem, privateKeyPassphrase } = params;

  let aesKey: Buffer;
  try {
    aesKey = privateDecrypt(
      {
        key: normalizePrivateKeyPem(privateKeyPem),
        passphrase: privateKeyPassphrase,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(request.encrypted_aes_key, 'base64'),
    );
  } catch (error) {
    throw new FlowDecryptionError(
      'No se pudo descifrar la clave AES con la clave privada configurada.',
      error,
    );
  }

  const initialVector = Buffer.from(request.initial_vector, 'base64');
  const payload = Buffer.from(request.encrypted_flow_data, 'base64');

  if (payload.length <= AUTH_TAG_LENGTH) {
    throw new FlowDecryptionError(
      'El payload cifrado es más corto que el tag de autenticación.',
    );
  }

  // El tag de GCM viaja pegado al final del ciphertext, no en un campo aparte.
  const ciphertext = payload.subarray(0, payload.length - AUTH_TAG_LENGTH);
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);

  let plaintext: string;
  try {
    const decipher = createDecipheriv(
      aesAlgorithmFor(aesKey),
      aesKey,
      initialVector,
    );
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf-8');
  } catch (error) {
    throw new FlowDecryptionError(
      'No se pudo descifrar el cuerpo del Flow.',
      error,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(plaintext);
  } catch (error) {
    throw new FlowDecryptionError(
      'El cuerpo descifrado no es JSON válido.',
      error,
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new FlowDecryptionError('El cuerpo descifrado no es un objeto.');
  }

  return { body: body as Record<string, unknown>, aesKey, initialVector };
}

/**
 * Cifra la respuesta reutilizando la clave AES de la petición, con el IV
 * invertido. Devuelve base64, que es el cuerpo literal de la respuesta HTTP.
 */
export function encryptFlowResponse(params: {
  response: unknown;
  aesKey: Buffer;
  initialVector: Buffer;
}): string {
  const { response, aesKey, initialVector } = params;

  const flippedIv = flipInitialVector(initialVector);
  const cipher = createCipheriv(aesAlgorithmFor(aesKey), aesKey, flippedIv);

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf-8'),
    cipher.final(),
  ]);

  return Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64');
}

/** Cada byte del IV invertido, según lo especifica Meta. */
export function flipInitialVector(initialVector: Buffer): Buffer {
  const flipped = Buffer.alloc(initialVector.length);
  for (let index = 0; index < initialVector.length; index += 1) {
    flipped[index] = ~initialVector[index] & 0xff;
  }
  return flipped;
}

/**
 * Verifica la firma `X-Hub-Signature-256` sobre el cuerpo **crudo**.
 *
 * Tiene que ser el cuerpo tal cual llegó: si se firma sobre el JSON reserializado
 * el HMAC no coincide, porque cualquier diferencia de espacios u orden de claves
 * cambia los bytes.
 */
export function isValidSignature(params: {
  rawBody: Buffer | string;
  signatureHeader?: string;
  appSecret: string;
}): boolean {
  const { rawBody, signatureHeader, appSecret } = params;

  if (!signatureHeader?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const received = signatureHeader.slice('sha256='.length);

  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(received, 'hex');

  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/** Meta usa AES-128, pero el algoritmo se deriva del largo real de la clave. */
function aesAlgorithmFor(aesKey: Buffer): CipherGCMTypes {
  switch (aesKey.length * 8) {
    case 128:
      return 'aes-128-gcm';
    case 192:
      return 'aes-192-gcm';
    case 256:
      return 'aes-256-gcm';
    default:
      throw new FlowDecryptionError(
        `Largo de clave AES inesperado: ${aesKey.length * 8} bits.`,
      );
  }
}
