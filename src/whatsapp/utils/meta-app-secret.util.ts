import type { ConfigService } from '@nestjs/config';

/**
 * App secret de la aplicación de Meta (Configuración → Básica → Clave secreta).
 *
 * No existe un secreto propio de WhatsApp: la firma `X-Hub-Signature-256` de
 * todos los webhooks —mensajes, eventos de cuenta y Flows— la calcula Meta con
 * el secreto de la app. Se acepta el nombre `META_APP_SECRET`, que es el
 * correcto, y también el histórico `WHATSAPP_APP_SECRET` para no romper
 * despliegues existentes.
 *
 * Se recorta porque un salto de línea pegado sin querer cambia el HMAC por
 * completo y produce exactamente el mismo error que un secreto equivocado.
 */
export function readMetaAppSecret(
  configService: ConfigService,
): string | undefined {
  const raw =
    configService.get<string>('META_APP_SECRET') ??
    configService.get<string>('WHATSAPP_APP_SECRET');

  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
