import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Lo más corto que tiene sentido bloquear: la celda de la agenda. */
const MIN_DURATION_MINUTES = 15;

/**
 * Un día entero. Es el tope y no una regla de negocio: un bloqueo más largo son
 * vacaciones, que se cargan por rango de fechas y no clickeando un hueco.
 */
const MAX_DURATION_MINUTES = 24 * 60;

/** Un motivo es una nota al margen, no un texto libre donde escribir la historia. */
const MAX_REASON_LENGTH = 140;

/**
 * Marcar una franja como no disponible.
 *
 * Viaja un instante y una duración, igual que `CreateAppointmentDto`, y no
 * `{ fecha, hora }`: el panel ya sabe convertir el hueco que se clickeó a un
 * instante con la zona del negocio (`instantAtMinute`), y tener dos formas de
 * decir "cuándo" en la misma API es lo que después hace que una de las dos se
 * calcule mal.
 */
export class CreateScheduleBlockDto {
  @ApiProperty({
    example: '2026-09-10T13:00:00.000Z',
    description: 'Cuándo empieza el bloqueo, en ISO.',
  })
  @IsISO8601()
  startTime!: string;

  @ApiProperty({
    example: 60,
    minimum: MIN_DURATION_MINUTES,
    maximum: MAX_DURATION_MINUTES,
  })
  @IsInt()
  @Min(MIN_DURATION_MINUTES)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes!: number;

  @ApiPropertyOptional({
    description:
      'Profesional que no atiende. Ausente o null bloquea a todo el negocio.',
  })
  @IsOptional()
  @IsUUID()
  staffId?: string | null;

  @ApiPropertyOptional({
    example: 'Turno médico',
    maxLength: MAX_REASON_LENGTH,
    description: 'Solo se muestra en el panel. El cliente nunca lo ve.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string | null;
}
