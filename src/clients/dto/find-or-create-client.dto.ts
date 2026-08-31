import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * El cliente de una reserva creada desde el panel.
 *
 * El teléfono sigue siendo opcional porque hoy la agenda no lo pide: crea al
 * cliente con el nombre que se escribió en el formulario de reserva. Es el único
 * camino que todavía produce clientes sin teléfono —o sea, imposibles de
 * reconocer cuando esa misma persona escriba por WhatsApp—, y deja de serlo
 * cuando la agenda pase a elegir el cliente de una lista.
 */
export class FindOrCreateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description:
      'Tal como lo escribió el negocio. Se normaliza en el servidor contra el país del negocio.',
  })
  @IsOptional()
  @IsString()
  phone?: string;
}
