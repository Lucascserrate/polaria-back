import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Qué turnos de la cuenta se piden.
 *
 * Un solo filtro, y opcional: el slug del negocio. Con él, la página de reservas
 * pregunta "¿ya tiene turno acá?" antes de dejar sacar otro; sin él, la
 * respuesta es la de toda Polaria, que es lo que va a leer la pantalla de turnos
 * de la cuenta el día que exista.
 */
export class CustomerAppointmentsQueryDto {
  /**
   * El slug del negocio, con la misma forma que la URL pública.
   *
   * Se valida con el patrón y no sólo como texto porque este valor termina en
   * una consulta por slug: acotarlo acá es más barato que confiar en que quien
   * la escriba se acuerde.
   */
  @ApiPropertyOptional({ example: 'royal-barber' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/i, {
    message: 'business no es un slug válido',
  })
  business?: string;
}
