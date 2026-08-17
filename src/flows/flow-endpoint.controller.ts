import {
  Controller,
  Header,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import {
  decryptFlowRequest,
  encryptFlowResponse,
  FlowDecryptionError,
  isEncryptedFlowRequest,
  isValidSignature,
  type DecryptedFlowRequest,
} from './flow-crypto';
import {
  FlowEndpointService,
  type FlowEndpointRequest,
} from './flow-endpoint.service';

/**
 * Código con el que Meta entiende que debe renegociar la clave pública.
 *
 * Cualquier otro error se lee como "el endpoint está caído" y degrada la salud
 * del Flow, así que los fallos de descifrado se responden específicamente con
 * este.
 */
const HTTP_MISDIRECTED_REQUEST = 421;

/** Express con `rawBody: true` adjunta el cuerpo sin parsear. */
type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('flows')
export class FlowEndpointController {
  private readonly logger = new Logger(FlowEndpointController.name);

  constructor(
    private readonly flowEndpointService: FlowEndpointService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Endpoint de datos del Flow.
   *
   * Responde **texto plano en base64**, no JSON: es lo que espera Meta. Por eso
   * se escribe la respuesta a mano en lugar de devolver un objeto.
   */
  @Post('endpoint')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  async handle(
    @Req() request: RawBodyRequest,
    @Res() response: Response,
  ): Promise<void> {
    const privateKey = this.configService.get<string>(
      'WHATSAPP_FLOWS_PRIVATE_KEY',
    );
    if (!privateKey) {
      this.logger.error(
        'WHATSAPP_FLOWS_PRIVATE_KEY no está configurada; no se puede atender el Flow.',
      );
      response.status(HTTP_MISDIRECTED_REQUEST).send();
      return;
    }

    if (!this.hasValidSignature(request)) {
      // 432 no existe: una firma inválida significa que el emisor no es Meta.
      this.logger.warn('Petición de Flow con firma inválida, descartada.');
      response.status(401).send();
      return;
    }

    const body = request.body as unknown;
    if (!isEncryptedFlowRequest(body)) {
      this.logger.warn('Petición de Flow sin los campos cifrados esperados.');
      response.status(HTTP_MISDIRECTED_REQUEST).send();
      return;
    }

    let decrypted: DecryptedFlowRequest;
    try {
      decrypted = decryptFlowRequest({
        request: body,
        privateKeyPem: privateKey,
        privateKeyPassphrase: this.configService.get<string>(
          'WHATSAPP_FLOWS_PRIVATE_KEY_PASSPHRASE',
        ),
      });
    } catch (error) {
      const detail =
        error instanceof FlowDecryptionError ? error.message : String(error);
      this.logger.error(`Fallo al descifrar la petición del Flow: ${detail}`);
      response.status(HTTP_MISDIRECTED_REQUEST).send();
      return;
    }

    const screen = await this.flowEndpointService.handle(
      decrypted.body as FlowEndpointRequest,
    );

    response.status(200).send(
      encryptFlowResponse({
        response: screen,
        aesKey: decrypted.aesKey,
        initialVector: decrypted.initialVector,
      }),
    );
  }

  /**
   * La firma se valida sobre el cuerpo crudo.
   *
   * Distingue los motivos en el log a propósito: los tres terminan en el mismo
   * 401 con cuerpo vacío, y sin el detalle no hay forma de saber si falta el
   * secreto, si el cuerpo crudo no llegó o si el HMAC no coincide.
   */
  private hasValidSignature(request: RawBodyRequest): boolean {
    const appSecret = this.readAppSecret();

    if (this.skipsSignatureCheck()) {
      this.logger.error(
        'WHATSAPP_FLOWS_SKIP_SIGNATURE activo: se acepta la petición SIN validar la firma. Solo para diagnóstico.',
      );
      return true;
    }

    if (!appSecret) {
      this.logger.warn(
        'Sin app secret configurado: no se valida la firma del Flow.',
      );
      return true;
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        'Firma no verificable: no llegó el cuerpo crudo. Falta `rawBody: true` en NestFactory.create.',
      );
      return false;
    }

    const signatureHeader = request.header('x-hub-signature-256');
    if (!signatureHeader) {
      this.logger.error(
        'Firma no verificable: Meta no envió el header x-hub-signature-256 en esta petición.',
      );
      return false;
    }

    const valid = isValidSignature({ rawBody, signatureHeader, appSecret });
    if (!valid) {
      // El largo del cuerpo y el prefijo del header alcanzan para descartar un
      // problema de codificación sin exponer el secreto.
      this.logger.error(
        `Firma inválida: el HMAC no coincide (rawBodyBytes=${rawBody.length}, secretoChars=${appSecret.length}, headerPrefix=${signatureHeader.slice(0, 14)}…). Revisar que el app secret sea el de la app dueña del Flow.`,
      );
    }

    return valid;
  }

  /**
   * App secret de la aplicación de Meta (Configuración → Básica → Clave secreta).
   *
   * No existe un secreto propio de WhatsApp: la firma `X-Hub-Signature-256` la
   * calcula Meta con el secreto de la app dueña del Flow. Se acepta el nombre
   * `META_APP_SECRET`, que es el correcto, y también el histórico
   * `WHATSAPP_APP_SECRET` para no romper despliegues existentes.
   *
   * Se recorta porque un salto de línea pegado sin querer cambia el HMAC por
   * completo y produce exactamente el mismo error que un secreto equivocado.
   */
  private readAppSecret(): string | undefined {
    const raw =
      this.configService.get<string>('META_APP_SECRET') ??
      this.configService.get<string>('WHATSAPP_APP_SECRET');

    const trimmed = raw?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * Escotilla para aislar el problema cuando la firma bloquea la integración.
   *
   * Deja pasar peticiones sin verificar quién las manda, así que loguea un error
   * en cada llamada para que sea imposible olvidársela encendida. El cifrado
   * sigue actuando: sin la clave pública registrada nadie puede armar un payload
   * que nuestra clave privada descifre.
   */
  private skipsSignatureCheck(): boolean {
    return (
      this.configService.get<string>('WHATSAPP_FLOWS_SKIP_SIGNATURE') === 'true'
    );
  }
}
