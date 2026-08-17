import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'crypto';

import {
  decryptFlowRequest,
  encryptFlowResponse,
  flipInitialVector,
  FlowDecryptionError,
  isEncryptedFlowRequest,
  isValidSignature,
  normalizePrivateKeyPem,
  type EncryptedFlowRequest,
} from './flow-crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Reproduce lo que hace Meta al llamar a nuestro endpoint. */
function encryptLikeMeta(
  body: unknown,
  overrides: { aesKey?: Buffer; initialVector?: Buffer } = {},
): { request: EncryptedFlowRequest; aesKey: Buffer; initialVector: Buffer } {
  const aesKey = overrides.aesKey ?? randomBytes(16);
  const initialVector = overrides.initialVector ?? randomBytes(16);

  const cipher = createCipheriv('aes-128-gcm', aesKey, initialVector);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(body), 'utf-8'),
    cipher.final(),
  ]);
  const payload = Buffer.concat([ciphertext, cipher.getAuthTag()]);

  const encryptedAesKey = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey,
  );

  return {
    request: {
      encrypted_flow_data: payload.toString('base64'),
      encrypted_aes_key: encryptedAesKey.toString('base64'),
      initial_vector: initialVector.toString('base64'),
    },
    aesKey,
    initialVector,
  };
}

/** Descifra como lo haría Meta al recibir nuestra respuesta. */
function decryptLikeMeta(
  encryptedResponse: string,
  aesKey: Buffer,
  initialVector: Buffer,
): unknown {
  const payload = Buffer.from(encryptedResponse, 'base64');
  const ciphertext = payload.subarray(0, payload.length - 16);
  const authTag = payload.subarray(payload.length - 16);

  const decipher = createDecipheriv(
    'aes-128-gcm',
    aesKey,
    flipInitialVector(initialVector),
  );
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf-8');

  return JSON.parse(plaintext);
}

describe('decryptFlowRequest', () => {
  it('descifra una petición cifrada como la manda Meta', () => {
    const payload = {
      version: '3.0',
      action: 'INIT',
      screen: 'SERVICE',
      data: {},
      flow_token: 'sess_abc',
    };
    const { request } = encryptLikeMeta(payload);

    const decrypted = decryptFlowRequest({
      request,
      privateKeyPem: privateKey,
    });

    expect(decrypted.body).toEqual(payload);
    expect(decrypted.aesKey).toHaveLength(16);
  });

  it('devuelve la clave y el IV para poder cifrar la respuesta', () => {
    const { request, aesKey, initialVector } = encryptLikeMeta({ a: 1 });

    const decrypted = decryptFlowRequest({
      request,
      privateKeyPem: privateKey,
    });

    expect(decrypted.aesKey.equals(aesKey)).toBe(true);
    expect(decrypted.initialVector.equals(initialVector)).toBe(true);
  });

  it('falla si la clave privada no corresponde a la pública', () => {
    const otro = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const { request } = encryptLikeMeta({ a: 1 });

    expect(() =>
      decryptFlowRequest({ request, privateKeyPem: otro.privateKey }),
    ).toThrow(FlowDecryptionError);
  });

  it('falla si el payload fue alterado: el tag de GCM no valida', () => {
    const { request } = encryptLikeMeta({ a: 1 });

    const tampered = Buffer.from(request.encrypted_flow_data, 'base64');
    tampered[0] ^= 0xff;

    expect(() =>
      decryptFlowRequest({
        request: {
          ...request,
          encrypted_flow_data: tampered.toString('base64'),
        },
        privateKeyPem: privateKey,
      }),
    ).toThrow(FlowDecryptionError);
  });

  it('falla si el payload es más corto que el tag', () => {
    const { request } = encryptLikeMeta({ a: 1 });

    expect(() =>
      decryptFlowRequest({
        request: {
          ...request,
          encrypted_flow_data: Buffer.alloc(8).toString('base64'),
        },
        privateKeyPem: privateKey,
      }),
    ).toThrow(/más corto que el tag/);
  });

  it('falla si el contenido descifrado no es JSON', () => {
    const aesKey = randomBytes(16);
    const initialVector = randomBytes(16);

    const cipher = createCipheriv('aes-128-gcm', aesKey, initialVector);
    const ciphertext = Buffer.concat([
      cipher.update('esto no es json', 'utf-8'),
      cipher.final(),
    ]);

    const request: EncryptedFlowRequest = {
      encrypted_flow_data: Buffer.concat([
        ciphertext,
        cipher.getAuthTag(),
      ]).toString('base64'),
      encrypted_aes_key: publicEncrypt(
        {
          key: publicKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        aesKey,
      ).toString('base64'),
      initial_vector: initialVector.toString('base64'),
    };

    expect(() =>
      decryptFlowRequest({ request, privateKeyPem: privateKey }),
    ).toThrow(/no es JSON válido/);
  });
});

describe('normalización de la clave privada', () => {
  // Las plataformas de deploy maltratan los saltos de línea del PEM de formas
  // distintas. Las tres variantes tienen que funcionar igual.
  const payload = { version: '3.0', action: 'INIT' };

  it('acepta el PEM tal cual', () => {
    const { request } = encryptLikeMeta(payload);

    expect(
      decryptFlowRequest({ request, privateKeyPem: privateKey }).body,
    ).toEqual(payload);
  });

  it('acepta el PEM con \\n literales', () => {
    const { request } = encryptLikeMeta(payload);
    const escaped = privateKey.replace(/\n/g, '\\n');

    expect(
      decryptFlowRequest({ request, privateKeyPem: escaped }).body,
    ).toEqual(payload);
  });

  it('acepta el PEM en base64', () => {
    const { request } = encryptLikeMeta(payload);
    const base64 = Buffer.from(privateKey, 'utf-8').toString('base64');

    expect(decryptFlowRequest({ request, privateKeyPem: base64 }).body).toEqual(
      payload,
    );
  });

  it('normalizePrivateKeyPem deja el PEM listo para Node en los tres casos', () => {
    const esperado = privateKey.trim();

    expect(normalizePrivateKeyPem(privateKey)).toBe(esperado);
    expect(normalizePrivateKeyPem(privateKey.replace(/\n/g, '\\n'))).toBe(
      esperado,
    );
    expect(
      normalizePrivateKeyPem(Buffer.from(privateKey).toString('base64')),
    ).toBe(esperado);
  });
});

describe('encryptFlowResponse', () => {
  it('produce algo que Meta puede descifrar con el IV invertido', () => {
    const { request } = encryptLikeMeta({ action: 'INIT' });
    const decrypted = decryptFlowRequest({
      request,
      privateKeyPem: privateKey,
    });

    const response = { version: '3.0', screen: 'SERVICE', data: { a: 1 } };
    const encrypted = encryptFlowResponse({
      response,
      aesKey: decrypted.aesKey,
      initialVector: decrypted.initialVector,
    });

    expect(
      decryptLikeMeta(encrypted, decrypted.aesKey, decrypted.initialVector),
    ).toEqual(response);
  });

  it('no reutiliza el IV de la petición', () => {
    // Reusar el par (clave, IV) rompe la garantía de AES-GCM. Meta lo evita
    // exigiendo el IV invertido, y este test fija ese comportamiento.
    const aesKey = randomBytes(16);
    const initialVector = randomBytes(16);

    const encrypted = encryptFlowResponse({
      response: { ok: true },
      aesKey,
      initialVector,
    });

    const payload = Buffer.from(encrypted, 'base64');
    const decipher = createDecipheriv('aes-128-gcm', aesKey, initialVector);
    decipher.setAuthTag(payload.subarray(payload.length - 16));

    expect(() => {
      decipher.update(payload.subarray(0, payload.length - 16));
      decipher.final();
    }).toThrow();
  });
});

describe('flipInitialVector', () => {
  it('invierte cada byte', () => {
    const original = Buffer.from([0x00, 0xff, 0x0f, 0xa5]);

    expect([...flipInitialVector(original)]).toEqual([0xff, 0x00, 0xf0, 0x5a]);
  });

  it('aplicarlo dos veces devuelve el original', () => {
    const original = randomBytes(16);

    expect(
      flipInitialVector(flipInitialVector(original)).equals(original),
    ).toBe(true);
  });
});

describe('isEncryptedFlowRequest', () => {
  it('reconoce el cuerpo de Meta', () => {
    const { request } = encryptLikeMeta({ a: 1 });

    expect(isEncryptedFlowRequest(request)).toBe(true);
  });

  it('rechaza cuerpos incompletos o de otro tipo', () => {
    expect(isEncryptedFlowRequest(null)).toBe(false);
    expect(isEncryptedFlowRequest({})).toBe(false);
    expect(isEncryptedFlowRequest({ encrypted_aes_key: 'x' })).toBe(false);
    expect(isEncryptedFlowRequest('texto')).toBe(false);
  });
});

describe('isValidSignature', () => {
  const appSecret = 'app-secret';
  const rawBody = Buffer.from('{"encrypted_flow_data":"abc"}');

  function sign(body: Buffer | string, secret = appSecret): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require('crypto') as typeof import('crypto');
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  it('acepta una firma correcta', () => {
    expect(
      isValidSignature({
        rawBody,
        signatureHeader: sign(rawBody),
        appSecret,
      }),
    ).toBe(true);
  });

  it('rechaza una firma de otro secreto', () => {
    expect(
      isValidSignature({
        rawBody,
        signatureHeader: sign(rawBody, 'otro-secreto'),
        appSecret,
      }),
    ).toBe(false);
  });

  it('rechaza si el cuerpo cambió aunque sea un byte', () => {
    expect(
      isValidSignature({
        rawBody: Buffer.from('{"encrypted_flow_data":"abd"}'),
        signatureHeader: sign(rawBody),
        appSecret,
      }),
    ).toBe(false);
  });

  it('rechaza cuando falta el header o no tiene el prefijo', () => {
    expect(isValidSignature({ rawBody, appSecret })).toBe(false);
    expect(
      isValidSignature({ rawBody, signatureHeader: 'abc', appSecret }),
    ).toBe(false);
  });

  it('rechaza una firma de largo distinto sin lanzar', () => {
    expect(
      isValidSignature({
        rawBody,
        signatureHeader: 'sha256=aabb',
        appSecret,
      }),
    ).toBe(false);
  });
});
