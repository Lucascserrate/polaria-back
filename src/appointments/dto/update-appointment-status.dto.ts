import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AppointmentStatus } from '../entities/appointment.entity';

/**
 * Cambio de estado de una cita, desde el panel.
 *
 * Es lo único que acepta `PATCH /appointments/:id`, y por eso se declara solo
 * eso. Antes era `PartialType(CreateAppointmentDto)`, que dejó de tener `status`
 * cuando la creación pasó a derivarlo de la fecha: con `forbidNonWhitelisted`
 * activo, marcar una cita como atendida empezó a devolver 400 sin que nadie
 * tocara esta ruta. Un DTO que dice de verdad qué recibe no se puede desfasar
 * así.
 */
export class UpdateAppointmentStatusDto {
  @ApiProperty({ enum: AppointmentStatus })
  @IsEnum(AppointmentStatus)
  status!: AppointmentStatus;
}
