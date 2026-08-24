import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../../config/validation-pipe.options';
import { AppointmentStatus } from '../entities/appointment.entity';
import { UpdateAppointmentStatusDto } from './update-appointment-status.dto';

/**
 * Se valida con la configuración real de la app, no con una equivalente.
 *
 * El bug que motivó estos tests no estaba en el DTO ni en el pipe por separado:
 * estaba en la combinación. Probar el DTO con un pipe permisivo lo habría dado
 * por bueno.
 */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: UpdateAppointmentStatusDto });

describe('UpdateAppointmentStatusDto', () => {
  it('acepta marcar una cita como atendida', async () => {
    await expect(validate({ status: 'completed' })).resolves.toEqual({
      status: AppointmentStatus.COMPLETED,
    });
  });

  it('acepta cancelarla', async () => {
    await expect(validate({ status: 'cancelled' })).resolves.toEqual({
      status: AppointmentStatus.CANCELLED,
    });
  });

  it('rechaza un estado que no existe', async () => {
    await expect(validate({ status: 'atendida' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza el cuerpo vacío', async () => {
    await expect(validate({})).rejects.toThrow(BadRequestException);
  });

  it('rechaza reescribir la reserva por esta ruta', async () => {
    // Cuándo empieza y qué servicios tiene se editan en `PATCH :id/booking`,
    // que revalida disponibilidad. Colarlos acá saltearía esa validación.
    await expect(
      validate({ status: 'completed', startTime: '2026-08-24T13:00:00.000Z' }),
    ).rejects.toThrow(BadRequestException);
  });
});
