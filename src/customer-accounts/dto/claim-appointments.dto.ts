import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * El token de un enlace de WhatsApp, para adoptar los turnos que nombra.
 *
 * Viaja en el cuerpo y no en la URL a propósito: una dirección queda en el
 * historial del navegador, en los `Referer` y en cualquier log de acceso, y
 * aunque este token no dé acceso por sí solo, no hay razón para regarlo.
 *
 * El largo se acota antes de intentar verificarlo: es lo que evita gastar
 * criptografía en una cadena de un megabyte.
 */
export class ClaimAppointmentsDto {
  @ApiProperty()
  @IsString()
  @Length(1, 2048)
  token!: string;
}
