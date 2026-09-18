import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

class SegmentPriceDto {
  @ApiProperty({ description: 'Servicio de la cita al que se le pone precio.' })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'El importe, o null para dejarlo sin precio.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'El precio no puede ser negativo' })
  price?: number | null;
}

/**
 * Lo que se cobra en una cita que ya existe.
 *
 * Tiene ruta propia y no entra por la edición de la reserva —que recibe el estado
 * deseado completo— porque acá no cambia nada de lo que ocupa la agenda: ni el
 * horario, ni los servicios, ni el profesional. La edición borra los tramos y los
 * vuelve a insertar para reacomodarlos, y hacer eso para escribir un número es
 * pedirle a la cita que pase otra vez por el índice único, por la revalidación de
 * disponibilidad y por los horarios del negocio. Una cita que ya se atendió —a la
 * que justamente se le está poniendo el precio— puede fallar en cualquiera de las
 * tres, y el precio no tiene nada que ver con eso.
 *
 * Es el precio pactado, no una lista de precios: escribirlo acá no toca el
 * catálogo, igual que cambiar el catálogo no toca las citas ya cobradas.
 */
export class SetSegmentPricesDto {
  @ApiProperty({ type: [SegmentPriceDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SegmentPriceDto)
  prices!: SegmentPriceDto[];
}
