/**
 * Cómo se acomodan en el tiempo los servicios de una reserva cuando algunos
 * pueden atenderse a la vez.
 *
 * Todo acá es puro y no conoce la agenda, ni profesionales, ni fechas: decide
 * **formas** posibles de repartir los servicios, y quién las puede cumplir lo
 * resuelve después el motor de disponibilidad. La separación no es estética. Es
 * la parte que se rompe en silencio: un plan mal armado no lanza nada, deja dos
 * servicios pisándose, un hueco en el medio o una reserva que dice durar una
 * hora y ocupa dos.
 *
 * ---
 *
 * **Un plan es una lista de tandas.** Cada tanda lleva uno o más servicios que
 * se atienden simultáneamente, y las tandas van una detrás de otra. La reserva
 * de siempre —un servicio, o varios encadenados sin reglas— es el caso
 * particular en que cada tanda tiene exactamente uno.
 *
 * **Se devuelve más de un plan, ordenados, y ese es el punto entero del
 * módulo.** Con un único plan "lo más paralelo posible", el salón que tiene una
 * sola profesional libre se queda sin horarios: manicure y pedicure irían juntas
 * a la fuerza, nadie podría cumplirlas, y el horario no se ofrecería, cuando
 * secuencialmente existía. Quien elige es la disponibilidad, que es la única que
 * sabe quién está libre; acá sólo se enumeran las opciones y se las ordena por
 * conveniencia para el cliente.
 */

/** Un servicio a ubicar, tal como lo pidió quien reserva. */
export type PlannableService = {
  serviceId: string;
  /** `NULL` es un estado normal y frecuente. Ver `pairMatrix`. */
  categoryId: string | null;
  durationMinutes: number;
};

/** Dónde cae un servicio dentro del bloque. */
export type ServicePlacement = {
  serviceId: string;
  /** Cuántos minutos después del inicio de la reserva arranca. */
  offsetMinutes: number;
  durationMinutes: number;
  /**
   * En qué tanda va. Dos servicios con el mismo `roundIndex` se atienden a la
   * vez y **exigen profesionales distintos**.
   */
  roundIndex: number;
};

export type ExecutionPlan = {
  /** Uno por servicio, en el mismo orden en que llegaron. */
  placements: ServicePlacement[];
  /** Lo que dura la reserva entera con este plan. */
  totalDurationMinutes: number;
  roundCount: number;
  /**
   * Cuántos profesionales distintos exige como mínimo: el tamaño de la tanda
   * más grande.
   *
   * Es lo que separa un plan que puede cumplir una persona sola de uno que
   * necesita dos en el local a la misma hora, y por eso participa del orden.
   */
  maxConcurrency: number;
};

/**
 * Si dos servicios pueden compartir tanda.
 *
 * Recibe las categorías y no los servicios porque la regla que el negocio carga
 * es entre categorías: diez manicures y diez pedicures son cien pares de
 * servicios y una sola regla de categorías, y esa diferencia es la que decide si
 * alguien configura la función o la abandona.
 */
export type ParallelPredicate = (
  categoryAId: string,
  categoryBId: string,
) => boolean;

/**
 * Tope de servicios que se planifican enumerando todas las formas posibles.
 *
 * La cantidad de repartos posibles crece muy rápido —52 para cinco servicios,
 * 203 para seis, 877 para siete—, así que por encima de este número se deja de
 * explorar y se devuelve únicamente el plan encadenado de siempre. No es un
 * límite de producto: `MAX_SERVICES_PER_BOOKING` ya corta en cinco, y esto es el
 * seguro de que subirlo allá no se convierta en una consulta cara acá sin que
 * nadie lo note.
 */
export const MAX_PLANNED_SERVICES = 6;

/**
 * Las formas de acomodar estos servicios, de la más conveniente a la menos.
 *
 * Siempre devuelve al menos un plan —el encadenado— y lo devuelve **último**:
 * es el que siempre se puede cumplir, porque no exige que haya nadie más en el
 * local. La disponibilidad los prueba en orden y se queda con el primero que
 * alguien pueda atender.
 *
 * El orden es, en este orden:
 *
 * 1. **Duración total ascendente.** Es lo único que el cliente pidió: terminar
 *    antes. Un plan que ahorra una hora gana a cualquier otra consideración.
 * 2. **Menos profesionales simultáneos.** A igual duración, el plan que puede
 *    cumplir menos gente es el que más veces va a ser posible.
 * 3. **Menos tandas**, y después una firma estable. Dos planes que empatan en
 *    todo tienen que salir siempre en el mismo orden: si no, la misma consulta
 *    repetida ofrecería reservas distintas.
 */
export function buildExecutionPlans(input: {
  /** En el orden en que los eligió el cliente. Ese orden no se toca. */
  services: PlannableService[];
  canRunInParallel: ParallelPredicate;
}): ExecutionPlan[] {
  const { services } = input;

  if (services.length === 0) return [];

  /*
   * Con un solo servicio no hay nada que repartir, y conviene que no pase por
   * ninguna rama nueva: es la reserva de WhatsApp, del Flow y del panel.
   */
  if (services.length === 1 || services.length > MAX_PLANNED_SERVICES) {
    return [sequentialPlan(services)];
  }

  const compatible = pairMatrix(services, input.canRunInParallel);

  const plans = enumerateGroupings(services.length, compatible).map((groups) =>
    toPlan(services, groups),
  );

  return plans.sort(comparePlans);
}

/** Cada servicio en su propia tanda: lo que Polaria hizo siempre. */
export function sequentialPlan(services: PlannableService[]): ExecutionPlan {
  return toPlan(
    services,
    services.map((_, index) => index),
  );
}

/**
 * El primer plan que una asignación concreta de profesionales puede cumplir.
 *
 * Existe para el panel, que no elige un horario de una lista: elige un instante
 * y una persona por servicio. Ahí el reparto no se hereda de lo que se le mostró
 * a nadie y hay que deducirlo, y lo que ya lo dice es a quién asignó el
 * administrador: **el plan más corto que su elección permite**. Si puso a dos
 * personas distintas para la manicure y la pedicure, salen a la vez; si puso a
 * la misma, salen una detrás de otra, porque es lo único que esa persona puede
 * hacer.
 *
 * `assignedTo` lleva un identificador por servicio, en el mismo orden. `null` o
 * `undefined` es "todavía sin asignar", y **no choca con nadie**: dos servicios
 * sin profesional no son el mismo profesional, y suponerlo escondería el plan
 * corto justo mientras se está armando la reserva.
 *
 * Siempre devuelve alguno mientras haya planes: el encadenado es el último de la
 * lista y nunca pone a nadie en dos lugares a la vez.
 */
export function pickPlanForAssignment(
  plans: ExecutionPlan[],
  assignedTo: Array<string | null | undefined>,
): ExecutionPlan | null {
  const fits = (plan: ExecutionPlan) =>
    plan.placements.every((placement, index) => {
      const assigned = assignedTo[index];
      if (!assigned) return true;

      return plan.placements.every(
        (other, otherIndex) =>
          otherIndex === index ||
          other.roundIndex !== placement.roundIndex ||
          assignedTo[otherIndex] !== assigned,
      );
    });

  return plans.find(fits) ?? null;
}

/**
 * Si un plan reparte algo entre dos personas a la vez.
 *
 * Lo pregunta quien tiene que explicar el plan —la pantalla que dice "te
 * atienden dos profesionales", el resumen de la reserva— y quien tiene que
 * decidir si `requireSingleStaff` todavía significa algo. Ver
 * `buildBookingSlots`.
 */
export function isParallelPlan(plan: ExecutionPlan): boolean {
  return plan.maxConcurrency > 1;
}

/**
 * Qué servicios comparten tanda, agrupados y en orden.
 *
 * Existe para que quien dibuja no tenga que reagrupar los `placements` por su
 * cuenta cada vez: sería la misma cuenta hecha en dos lados, y cuando se
 * separan la pantalla dice una cosa y la agenda otra.
 */
export function roundsOf(plan: ExecutionPlan): ServicePlacement[][] {
  const rounds: ServicePlacement[][] = Array.from(
    { length: plan.roundCount },
    () => [],
  );

  for (const placement of plan.placements) {
    rounds[placement.roundIndex].push(placement);
  }

  return rounds;
}

/**
 * Qué pares de servicios pueden compartir tanda, resuelto una sola vez.
 *
 * Dos servicios **sin categoría** nunca son compatibles, y tampoco lo son dos de
 * la **misma** categoría. Lo primero es la degradación correcta para el catálogo
 * que ya existe: en Polaria `categoryId` en `NULL` es un estado permanente y
 * mayoritario, y paralelizar por defecto sería agendar en simultáneo cosas que
 * nadie declaró simultáneas. Lo segundo es semántica: dos manicures a la vez
 * sobre la misma clienta no existen, y si existieran serían un servicio propio.
 */
function pairMatrix(
  services: PlannableService[],
  canRunInParallel: ParallelPredicate,
): boolean[][] {
  const size = services.length;
  const matrix = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  for (let a = 0; a < size; a++) {
    for (let b = a + 1; b < size; b++) {
      const categoryA = services[a].categoryId;
      const categoryB = services[b].categoryId;

      const allowed =
        categoryA !== null &&
        categoryB !== null &&
        categoryA !== categoryB &&
        canRunInParallel(categoryA, categoryB);

      matrix[a][b] = allowed;
      matrix[b][a] = allowed;
    }
  }

  return matrix;
}

/**
 * Todas las formas de repartir `size` servicios en tandas válidas.
 *
 * Devuelve, por cada forma, un arreglo que dice en qué tanda cae cada servicio.
 * La numeración es creciente y sin huecos —el servicio 0 siempre está en la
 * tanda 0, y una tanda nueva es siempre la siguiente—, que es lo que hace que
 * cada reparto se genere **una sola vez** en lugar de una por cada manera de
 * numerarlo. De paso, el número de tanda termina siendo el orden de aparición de
 * su primer servicio, así que las tandas salen en el orden en que el cliente
 * eligió.
 *
 * **Una tanda exige compatibilidad de a pares entre todos sus servicios**, no
 * encadenada. Si las uñas conviven con los pies y los pies con las cejas, pero
 * las uñas con las cejas no, los tres juntos no van: en esa tanda habría un par
 * que el negocio nunca declaró simultáneo.
 */
function enumerateGroupings(size: number, compatible: boolean[][]): number[][] {
  const results: number[][] = [];
  const assignment: number[] = [];

  const place = (index: number, roundCount: number): void => {
    if (index === size) {
      results.push([...assignment]);
      return;
    }

    for (let round = 0; round < roundCount; round++) {
      const fits = assignment.every(
        (assigned, other) => assigned !== round || compatible[index][other],
      );
      if (!fits) continue;

      assignment[index] = round;
      place(index + 1, roundCount);
    }

    // Y siempre, además, la tanda nueva: nada obliga a agrupar.
    assignment[index] = roundCount;
    place(index + 1, roundCount + 1);
    assignment.length = index;
  };

  place(0, 0);

  return results;
}

/**
 * De un reparto a un plan con horarios relativos.
 *
 * **Una tanda dura lo que su servicio más largo**, y todos sus servicios
 * arrancan juntos. Si van manicure de 60 y pedicure de 30, la tanda dura 60 y la
 * segunda profesional queda libre a la media hora. Ese hueco es real y correcto:
 * esa persona efectivamente se libera, y la agenda tiene que poder ofrecérsela a
 * otro cliente.
 *
 * Alinearlos al final en vez de al principio —para que la clienta no espere
 * sentada— es una mejora posible y no es esta: obligaría a decidir cuál de los
 * dos conviene demorar, que es una pregunta del negocio y no del planificador.
 */
function toPlan(
  services: PlannableService[],
  assignment: number[],
): ExecutionPlan {
  const roundCount = Math.max(...assignment) + 1;

  const roundDurations = Array.from({ length: roundCount }, (_, round) =>
    Math.max(
      ...services
        .filter((_, index) => assignment[index] === round)
        .map((service) => service.durationMinutes),
    ),
  );

  const roundOffsets: number[] = [];
  let cursor = 0;
  for (const duration of roundDurations) {
    roundOffsets.push(cursor);
    cursor += duration;
  }

  const roundSizes = Array.from(
    { length: roundCount },
    (_, round) => assignment.filter((assigned) => assigned === round).length,
  );

  return {
    placements: services.map((service, index) => ({
      serviceId: service.serviceId,
      offsetMinutes: roundOffsets[assignment[index]],
      durationMinutes: service.durationMinutes,
      roundIndex: assignment[index],
    })),
    totalDurationMinutes: cursor,
    roundCount,
    maxConcurrency: Math.max(...roundSizes),
  };
}

function comparePlans(a: ExecutionPlan, b: ExecutionPlan): number {
  if (a.totalDurationMinutes !== b.totalDurationMinutes) {
    return a.totalDurationMinutes - b.totalDurationMinutes;
  }
  if (a.maxConcurrency !== b.maxConcurrency) {
    return a.maxConcurrency - b.maxConcurrency;
  }
  if (a.roundCount !== b.roundCount) return a.roundCount - b.roundCount;

  return signatureOf(a) < signatureOf(b) ? -1 : 1;
}

/** Desempate estable: el reparto escrito como texto. */
function signatureOf(plan: ExecutionPlan): string {
  return plan.placements.map((placement) => placement.roundIndex).join(',');
}
