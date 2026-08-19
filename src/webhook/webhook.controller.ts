import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { WebhookService } from './webhook.service';
import { isValidSignature } from '../flows/flow-crypto';
import { readMetaAppSecret } from '../whatsapp/utils/meta-app-secret.util';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
  ) {}

  private get verifyToken(): string {
    return (
      this.configService.get<string>('WHATSAPP_VERIFY_TOKEN') ?? 'polaria123'
    );
  }

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
  ): string {
    if (mode === 'subscribe' && token === this.verifyToken) {
      return challenge;
    }

    throw new ForbiddenException();
  }

  @Post()
  receiveMessage(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.hasValidSignature(request)) {
      throw new ForbiddenException();
    }

    return this.webhookService.handleIncomingWhatsAppWebhook(body);
  }

  /**
   * La firma se valida sobre el cuerpo crudo y antes de mirar nada del payload.
   *
   * Dejó de ser opcional cuando este endpoint pasó a recibir `account_update`:
   * sin firma, cualquiera que conozca un `waba_id` podría marcar la integración
   * de un negocio como caída con un POST. Con mensajes el daño era ensuciar un
   * hilo; acá es apagar la operación de otro.
   *
   * Sin secreto configurado se rechaza todo. Es la única postura coherente: un
   * endpoint que acepta lo que no puede verificar no está verificando nada, y
   * dejar pasar peticiones "hasta que alguien configure la variable" convierte
   * un olvido de despliegue en una puerta abierta que nadie vuelve a mirar.
   *
   * El costo es que un despliegue sin `META_APP_SECRET` deja al negocio sin
   * recibir mensajes. Por eso el log dice exactamente qué falta: es un problema
   * de configuración con una sola causa y un solo arreglo.
   */
  private hasValidSignature(request: RawBodyRequest<Request>): boolean {
    const appSecret = readMetaAppSecret(this.configService);

    if (!appSecret) {
      this.logger.error(
        'Webhook rechazado: falta META_APP_SECRET y no se puede verificar la firma. ' +
          'Ningún mensaje de WhatsApp va a procesarse hasta configurarla.',
      );
      return false;
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
        'Firma no verificable: Meta no envió el header x-hub-signature-256.',
      );
      return false;
    }

    const valid = isValidSignature({ rawBody, signatureHeader, appSecret });
    if (!valid) {
      // El largo del cuerpo y el prefijo del header alcanzan para descartar un
      // problema de codificación sin exponer el secreto.
      this.logger.error(
        `Firma inválida: el HMAC no coincide (rawBodyBytes=${rawBody.length}, headerPrefix=${signatureHeader.slice(0, 14)}…).`,
      );
    }

    return valid;
  }
}
