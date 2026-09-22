import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Por qué columna se puede ordenar la lista. Ver `CLIENT_SORTS`. */
export const CLIENT_SORTS = ['name', 'lastVisit'] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class ListClientsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Busca en nombre, teléfono y email a la vez.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Por qué columna ordenar. Sin ella la lista sale por antigüedad, que es el
   * orden con el que se dio de alta cada ficha.
   */
  @ApiPropertyOptional({ enum: CLIENT_SORTS })
  @IsOptional()
  @IsIn(CLIENT_SORTS)
  sort?: ClientSort;

  /**
   * En qué sentido. Se aplica siempre al valor crudo de la columna: para
   * `lastVisit` eso es la **fecha** de la visita, así que `asc` son los que hace
   * más tiempo que no vienen.
   */
  @ApiPropertyOptional({ enum: SORT_ORDERS, default: 'asc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;
}
