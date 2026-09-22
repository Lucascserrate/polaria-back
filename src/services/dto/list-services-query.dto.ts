import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Qué parte del catálogo se pide.
 *
 * `active` es el catálogo vigente, y es el valor por defecto a propósito: es lo
 * que contestan todos los canales donde alguien elige un servicio —la página
 * pública, WhatsApp, el asistente, el panel de reserva— y ninguno de ellos tiene
 * nada que hacer con un servicio dado de baja.
 *
 * `all` suma los desactivados. Lo pide sólo el catálogo del panel, que es el
 * único lugar donde hay algo que hacer con ellos: verlos y volver a activarlos.
 * Sin esto no había forma de llegar a un servicio desactivado, así que la baja
 * era de ida.
 */
export const SERVICE_SCOPES = ['active', 'all'] as const;
export type ServiceScope = (typeof SERVICE_SCOPES)[number];

export class ListServicesQueryDto {
  @ApiPropertyOptional({ enum: SERVICE_SCOPES, default: 'active' })
  @IsOptional()
  @IsIn(SERVICE_SCOPES)
  scope?: ServiceScope;
}
