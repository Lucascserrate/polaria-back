/**
 * Repartir los servicios de una tanda entre profesionales distintos.
 *
 * Es lo que cambia cuando dos servicios pasan a poder atenderse a la vez. Con
 * tramos encadenados, cada uno se resolvía por su cuenta: como no se pisan,
 * quién atiende el segundo no depende de quién atendió el primero, y alcanzaba
 * con que cada tramo tuviera al menos un candidato. Dentro de una tanda eso deja
 * de ser cierto —la misma persona no puede estar en dos sillas a la vez—, y la
 * pregunta correcta ya no es "¿cada servicio tiene a alguien?" sino "**¿existe
 * un reparto que no repita a nadie?**".
 *
 * La diferencia no es teórica. Con una sola profesional habilitada para manicure
 * y pedicure, las dos listas de candidatos son no vacías y el reparto no existe:
 * preguntar tramo por tramo diría que el horario está disponible y la reserva
 * pondría a la misma persona en dos lugares al mismo tiempo.
 *
 * Es un emparejamiento bipartito. Se resuelve con caminos aumentantes, que a
 * esta escala —a lo sumo cinco servicios por reserva— sobra: no hace falta nada
 * más elaborado, y este cabe en una pantalla y se puede leer.
 */

/**
 * Un reparto sin repetidos, o `null` si no existe ninguno.
 *
 * Devuelve un profesional por posición, en el mismo orden en que llegaron los
 * candidatos. Una sola posición es el caso de siempre y sale por la primera
 * rama, sin construir nada.
 *
 * **El orden de cada lista de candidatos es una preferencia, no un requisito.**
 * Quien llama los ordena por lo que le importe —menor carga del día, después
 * id— y el algoritmo intenta respetarlo, pero va a romperlo antes que devolver
 * `null`: entre darle a alguien su segunda opción y no ofrecer el horario, la
 * respuesta correcta es la primera. Por eso esto decide *si se puede*, y la
 * preferencia se expresa en el orden y no como una garantía.
 */
export function assignDistinctStaff(
  candidatesBySegment: string[][],
): string[] | null {
  if (candidatesBySegment.length === 0) return [];
  if (candidatesBySegment.some((candidates) => candidates.length === 0)) {
    return null;
  }

  /*
   * Una sola posición no es un emparejamiento: es elegir al primero. Sale por
   * acá para que la reserva de un servicio —la de WhatsApp, la del Flow y la del
   * panel— no pase por ninguna rama nueva.
   */
  if (candidatesBySegment.length === 1) return [candidatesBySegment[0][0]];

  /** A qué posición quedó asignado cada profesional. */
  const takenBy = new Map<string, number>();

  const assign = (segment: number, tried: Set<string>): boolean => {
    for (const staffId of candidatesBySegment[segment]) {
      if (tried.has(staffId)) continue;
      tried.add(staffId);

      const holder = takenBy.get(staffId);

      /*
       * Libre, o su dueño actual puede correrse a otro candidato suyo. Lo
       * segundo es lo que hace que esto no sea un greedy: que el primer servicio
       * se haya quedado con la única persona que también podía hacer el segundo
       * no condena la reserva, la reacomoda.
       */
      if (holder === undefined || assign(holder, tried)) {
        takenBy.set(staffId, segment);
        return true;
      }
    }

    return false;
  };

  /*
   * Primero, a cada tramo su candidato preferido que esté libre.
   *
   * Sin esta pasada el reparto sale igual de válido pero peor: el segundo tramo
   * pide al mismo de siempre, lo desplaza porque puede, y el primero termina con
   * su segunda opción sin que nadie lo necesitara. Correrse tiene que ser la
   * salida cuando no hay otra, no el caso normal.
   */
  const pending: number[] = [];
  for (const [segment, candidates] of candidatesBySegment.entries()) {
    const free = candidates.find((staffId) => !takenBy.has(staffId));
    if (free === undefined) pending.push(segment);
    else takenBy.set(free, segment);
  }

  for (const segment of pending) {
    if (!assign(segment, new Set())) return null;
  }

  const assignment: string[] = new Array<string>(candidatesBySegment.length);
  for (const [staffId, segment] of takenBy) {
    assignment[segment] = staffId;
  }

  return assignment;
}

/** Si existe algún reparto posible. */
export function canAssignDistinctStaff(
  candidatesBySegment: string[][],
): boolean {
  return assignDistinctStaff(candidatesBySegment) !== null;
}
