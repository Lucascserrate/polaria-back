import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, MinLength } from 'class-validator';

/** A qué negocio se le pide acceso. */
export class CreateJoinRequestDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;
}

/**
 * Lo que se escribió en el buscador.
 *
 * El mínimo se valida acá **y** en el servicio. No es redundante: esto rechaza
 * la petición con un 400 claro, y aquello garantiza que ningún otro llamador
 * —hoy no hay, mañana puede haber— consiga un volcado del padrón pasando una
 * letra.
 */
export class JoinSearchQueryDto {
  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3, { message: 'Escribí al menos 3 letras del nombre' })
  q!: string;
}
