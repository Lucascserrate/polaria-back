import { ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../../config/validation-pipe.options';
import { CreateServiceDto } from './create-service.dto';
import { UpdateServiceDto } from './update-service.dto';

/**
 * Con la configuración real de la app, no con una equivalente: lo que se prueba
 * acá es la combinación del DTO con el pipe, que es donde `null` se pierde.
 */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

const service = {
  name: 'Coloración',
  timezone: 'America/La_Paz',
  durationMinutes: 60,
};

const validate = (body: unknown, metatype: unknown = CreateServiceDto) =>
  pipe.transform(body, {
    type: 'body',
    metatype: metatype as new () => unknown,
  });

describe('CreateServiceDto', () => {
  it('acepta un servicio sin precio, que se cotiza', async () => {
    await expect(validate({ ...service, price: null })).resolves.toMatchObject({
      price: null,
    });
  });

  it('acepta el precio cero, que es gratis y no es lo mismo', async () => {
    await expect(validate({ ...service, price: 0 })).resolves.toMatchObject({
      price: 0,
    });
  });

  it('rechaza el precio ausente: el que no existe se dice con null', async () => {
    // Un precio que se olvidó de mandar y uno que no existe se escriben igual en
    // la base y se leen distinto en la pantalla.
    await expect(validate(service)).rejects.toThrow();
  });

  it('rechaza un precio que no es número', async () => {
    await expect(
      validate({ ...service, price: 'a convenir' }),
    ).rejects.toThrow();
  });
});

describe('UpdateServiceDto', () => {
  it('deja tocar sólo el nombre sin mandar el precio', async () => {
    await expect(
      validate({ name: 'Coloración' }, UpdateServiceDto),
    ).resolves.toEqual({ name: 'Coloración' });
  });

  it('deja sacarle el precio a un servicio que ya lo tenía', async () => {
    await expect(
      validate({ price: null }, UpdateServiceDto),
    ).resolves.toMatchObject({ price: null });
  });
});
