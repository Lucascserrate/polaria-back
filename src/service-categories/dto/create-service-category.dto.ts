import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Lo que aguanta la columna, igual que en servicios: `varchar(255)` en las dos.
 *
 * Declarado acá y no sólo en la base porque sin esto un texto más largo llega
 * entero a MySQL, que responde `ER_DATA_TOO_LONG`, y eso sale como un 500 sin
 * decir qué campo.
 */
export const CATEGORY_TEXT_MAX_LENGTH = 255;

export class CreateServiceCategoryDto {
  @ApiProperty({ maxLength: CATEGORY_TEXT_MAX_LENGTH })
  @IsString()
  @MaxLength(CATEGORY_TEXT_MAX_LENGTH, {
    message: `El nombre no puede tener más de ${CATEGORY_TEXT_MAX_LENGTH} caracteres`,
  })
  name: string;

  @ApiPropertyOptional({ maxLength: CATEGORY_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CATEGORY_TEXT_MAX_LENGTH, {
    message: `La descripción no puede tener más de ${CATEGORY_TEXT_MAX_LENGTH} caracteres`,
  })
  description?: string;

  /**
   * Dónde va en el menú. Ausente la manda al final.
   *
   * No lo manda la pantalla todavía —las categorías se ordenan por nombre—, pero
   * el campo existe desde ahora para que reordenar sea agregar una pantalla y no
   * una migración.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
