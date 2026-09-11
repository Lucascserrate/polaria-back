import { BusinessPhotosService } from './business-photos.service';

type Row = { id: string; tenantId: string; position: number };

const setup = (ids: string[]) => {
  const rows: Row[] = ids.map((id, index) => ({
    id,
    tenantId: 't1',
    position: index,
  }));

  const repo = {
    find: jest.fn(({ order }: { order?: { position: 'ASC' } }) =>
      Promise.resolve(
        order ? [...rows].sort((a, b) => a.position - b.position) : [...rows],
      ),
    ),
    manager: {
      transaction: (work: (m: unknown) => Promise<void>) =>
        work({
          update: (
            _e: unknown,
            where: { id: string },
            patch: { position: number },
          ) => {
            const row = rows.find((r) => r.id === where.id);
            if (row) row.position = patch.position;
            return Promise.resolve({ affected: 1 });
          },
        }),
    },
  };

  const service = new BusinessPhotosService(
    repo as never,
    { uploadImage: jest.fn(), deleteImage: jest.fn() } as never,
  );

  return {
    service,
    rows,
    order: () =>
      [...rows].sort((a, b) => a.position - b.position).map((r) => r.id),
  };
};

/**
 * Que elegir portada siga funcionando la segunda vez, y la tercera.
 *
 * Se escribió persiguiendo un reporte de "cambié la portada una vez y después
 * no cambia más". La permutación resultó correcta —esto pasa—, así que sirve
 * para lo contrario de lo que se buscaba: deja descartado este lado cuando
 * vuelva a pasar, en lugar de volver a leerlo entero.
 *
 * El doble renumera de verdad, no cuenta llamadas: lo que importa es el orden
 * que queda, y una aserción sobre los `update` que se dispararon pasaría igual
 * con las posiciones mal calculadas.
 */
describe('setCover, orden resultante', () => {
  it('mueve la elegida al frente, tres veces seguidas', async () => {
    const { service, order } = setup(['A', 'B', 'C']);

    await service.setCover('t1', 'B');
    expect(order()).toEqual(['B', 'A', 'C']);

    await service.setCover('t1', 'C');
    expect(order()).toEqual(['C', 'B', 'A']);

    await service.setCover('t1', 'A');
    expect(order()).toEqual(['A', 'C', 'B']);
  });
});
