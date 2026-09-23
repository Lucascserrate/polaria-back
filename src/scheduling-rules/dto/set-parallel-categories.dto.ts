import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/**
 * Tope de categorías que pueden convivir con una misma.
 *
 * No es un límite de producto sino de lo que una reserva puede costar: cada
 * categoría compatible agrega repartos posibles que el planificador tiene que
 * evaluar. Un negocio con veinte categorías que conviven todas con todas no
 * existe; un formulario mal armado, sí.
 */
export const MAX_PARALLEL_CATEGORIES = 20;

export class SetParallelCategoriesDto {
  @ApiProperty({
    type: [String],
    description:
      'Categorías que se pueden atender al mismo tiempo que ésta. Reemplaza la lista completa.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_PARALLEL_CATEGORIES)
  @IsUUID(undefined, { each: true })
  categoryIds!: string[];
}
