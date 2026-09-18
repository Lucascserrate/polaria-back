import { groupServices, planServiceStep } from './service-grouping';

/** Lo que pasa una lista nativa de WhatsApp. */
const WHATSAPP_ROWS = 10;

/** `Cancelar`, que está en todos los pasos. */
const RESERVED = 1;

/** El plan para un catálogo donde cada servicio trae su categoría (o `null`). */
const plan = (categoryIds: Array<string | null>) =>
  planServiceStep({
    services: categoryIds.map((categoryId, index) => ({
      id: `svc-${index + 1}`,
      categoryId,
    })),
    categories: [...new Set(categoryIds.filter(Boolean))].map((id) => ({
      id: id as string,
      name: id as string,
    })),
    maxOptionsPerPrompt: WHATSAPP_ROWS,
    reservedOptions: RESERVED,
  });

/** `n` servicios repartidos cíclicamente entre las categorías dadas. */
const spread = (count: number, categories: Array<string | null>) =>
  Array.from(
    { length: count },
    (_, index) => categories[index % categories.length],
  );

describe('planServiceStep', () => {
  it('con un catálogo que entra en una lista no pregunta la categoría', () => {
    // Nueve es lo máximo que entra junto a `Cancelar`. Preguntar acá cobraría un
    // toque para ahorrar uno.
    expect(plan(spread(9, ['cabello', 'unas', 'barba'])).kind).toBe('SERVICES');
  });

  it('en cuanto no entra, pregunta la categoría', () => {
    // Diez es el primer catálogo que obligaría a un "Ver más opciones".
    const result = plan(spread(10, ['cabello', 'unas', 'barba']));

    expect(result.kind).toBe('CATEGORIES');
    if (result.kind !== 'CATEGORIES') return;
    expect(result.groups).toHaveLength(3);
  });

  it('no pregunta si todo cae en una sola categoría', () => {
    // La pregunta tendría una sola respuesta posible: no informa nada.
    expect(plan(spread(20, ['cabello'])).kind).toBe('SERVICES');
  });

  it('no pregunta si el negocio no armó categorías', () => {
    // Es el comportamiento de siempre: lista larga y paginada. Las categorías no
    // se inventan solas.
    expect(plan(spread(20, [null])).kind).toBe('SERVICES');
  });

  it('los que no tienen categoría son un grupo más, y va último', () => {
    const result = plan(spread(12, ['cabello', 'unas', null]));

    expect(result.kind).toBe('CATEGORIES');
    if (result.kind !== 'CATEGORIES') return;
    expect(result.groups.at(-1)?.category).toBeNull();
    expect(result.groups.at(-1)?.services).toHaveLength(4);
  });

  it('sin tope de opciones nunca pregunta: no hay paginado que evitar', () => {
    // Un Dropdown de Flows entra entero, así que el paso extra no compra nada.
    const result = planServiceStep({
      services: spread(40, ['cabello', 'unas']).map((categoryId, index) => ({
        id: `svc-${index}`,
        categoryId,
      })),
      categories: [
        { id: 'cabello', name: 'Cabello' },
        { id: 'unas', name: 'Uñas' },
      ],
    });

    expect(result.kind).toBe('SERVICES');
  });
});

describe('groupServices', () => {
  const categories = [
    { id: 'cabello', name: 'Cabello' },
    { id: 'unas', name: 'Uñas' },
  ];

  it('descarta las categorías vacías', () => {
    // En el panel una categoría vacía se muestra a propósito; acá sería una fila
    // que lleva a una lista sin nada.
    const groups = groupServices(
      [{ id: 'svc-1', categoryId: 'cabello' }],
      categories,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].category?.id).toBe('cabello');
  });

  it('respeta el orden en que vienen las categorías', () => {
    const groups = groupServices(
      [
        { id: 'svc-1', categoryId: 'unas' },
        { id: 'svc-2', categoryId: 'cabello' },
      ],
      categories,
    );

    expect(groups.map((group) => group.category?.id)).toEqual([
      'cabello',
      'unas',
    ]);
  });

  it('un servicio de una categoría que ya no existe no desaparece', () => {
    // El negocio borró la categoría con una sesión abierta: el cliente no puede
    // dejar de ver algo que se vende.
    const groups = groupServices(
      [{ id: 'svc-1', categoryId: 'borrada' }],
      categories,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBeNull();
    expect(groups[0].services).toHaveLength(1);
  });
});
