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
   * Sin `APP_SECRET` configurado no se puede verificar. Se deja pasar con una
   * advertencia para no bloquear el desarrollo local, pero en producción esto
   * significa aceptar peticiones de cualquiera.
   */
  private hasValidSignature(request: RawBodyRequest): boolean {
    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      this.logger.warn(
        'WHATSAPP_APP_SECRET no configurado: no se valida la firma del Flow.',
      );
      return true;
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      this.logger.error(
        'No hay cuerpo crudo disponible; falta habilitar rawBody en el bootstrap.',
      );
      return false;
    }

    return isValidSignature({
      rawBody,
      signatureHeader: request.header('x-hub-signature-256'),
      appSecret,
    });
  }
}
