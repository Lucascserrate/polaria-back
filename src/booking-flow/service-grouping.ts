import { computeOptionWindow } from './option-window';

/** Lo que el paso necesita saber de un servicio. */
export type GroupableService = {
  id: string;
  categoryId?: string | null;
};

/** Lo que el paso necesita saber de una categoría. Vienen ya ordenadas. */
export type GroupableCategory = {
  id: string;
  name: string;
  description?: string;
};

/** Un grupo con al menos un servicio reservable. */
export type ServiceGroup<S> = {
  /** `null` es el cajón de los que no están en ninguna categoría. */
  category: GroupableCategory | null;
  services: S[];
};

/**
 * Qué mostrar en el primer paso del flujo: el catálogo entero o sus categorías.
 *
 * `SERVICES` es el camino de siempre y sigue siendo el de la mayoría.
 * `CATEGORIES` mete un paso más, y solo se gana ese paso cuando evita algo peor.
 */
export type ServiceStepPlan<S> =
  | { kind: 'SERVICES'; services: S[] }
  | { kind: 'CATEGORIES'; groups: Array<ServiceGroup<S>> };

/**
 * Decide si el cliente ve primero las categorías o directo los servicios.
 *
 * La regla es una sola: **las categorías reemplazan al paginado**. Mientras el
 * catálogo entre en una lista, se manda la lista —un toque, todo a la vista— por
 * más categorías que el negocio haya armado. Recién cuando no entra, y por lo
 * tanto la alternativa es un "Ver más opciones" que esconde la mitad del
 * catálogo detrás de un toque igual de caro, conviene preguntar primero.
 *
 * Así el negocio de seis servicios no paga un paso por haber ordenado su
 * catálogo, y el salón de treinta deja de mandar una lista que nadie recorre.
 *
 * Hacen falta **dos** grupos como mínimo. Con uno solo, la pregunta tiene una
 * sola respuesta posible: es un toque que no informa ni decide nada.
 *
 * Los grupos vacíos no salen. En el panel una categoría vacía se muestra a
 * propósito —es la que hay que llenar—, pero acá sería una fila que lleva a una
 * lista sin servicios, o sea un callejón sin salida en la cara del cliente.
 */
export function planServiceStep<S extends GroupableService>(params: {
  /** Los que el cliente puede elegir, en el orden en que se van a mostrar. */
  services: S[];
  /** Las del negocio, ya ordenadas. Las vacías se descartan acá. */
  categories: GroupableCategory[];
  /** Tope de filas del canal. Sin tope no hay paginado, así que no hay motivo. */
  maxOptionsPerPrompt?: number;
  /** Filas que el paso agrega siempre, como `Cancelar`. */
  reservedOptions?: number;
}): ServiceStepPlan<S> {
  const { services, categories, maxOptionsPerPrompt, reservedOptions } = params;

  const fitsInOneList = !computeOptionWindow({
    total: services.length,
    offset: 0,
    maxOptionsPerPrompt,
    reservedOptions,
  }).hasMore;

  if (fitsInOneList) return { kind: 'SERVICES', services };

  const groups = groupServices(services, categories);

  if (groups.length < 2) return { kind: 'SERVICES', services };

  return { kind: 'CATEGORIES', groups };
}

/**
 * Reparte los servicios en sus grupos, descartando los vacíos.
 *
 * El cajón de los que no tienen categoría va último y solo si tiene algo: es
 * "Otros servicios", no una categoría más.
 *
 * Un servicio cuya categoría no está en la lista cae en ese cajón en lugar de
 * desaparecer. Pasa de verdad: entre que el negocio borra una categoría y una
 * sesión abierta recarga el catálogo, hay servicios apuntando a un id que ya no
 * existe, y el cliente no puede dejar de ver algo que se vende.
 */
export function groupServices<S extends GroupableService>(
  services: S[],
  categories: GroupableCategory[],
): Array<ServiceGroup<S>> {
  const byCategory = new Map<string, S[]>(
    categories.map((category) => [category.id, []]),
  );
  const uncategorized: S[] = [];

  for (const service of services) {
    const group = service.categoryId
      ? byCategory.get(service.categoryId)
      : undefined;
    (group ?? uncategorized).push(service);
  }

  const groups: Array<ServiceGroup<S>> = categories
    .filter((category) => (byCategory.get(category.id)?.length ?? 0) > 0)
    .map((category) => ({
      category,
      services: byCategory.get(category.id) ?? [],
    }));

  if (uncategorized.length > 0) {
    groups.push({ category: null, services: uncategorized });
  }

  return groups;
}
