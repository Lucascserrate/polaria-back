import type {
  BookingOption,
  BookingPrompt,
  BookingSummary,
} from '../booking-flow/booking-flow.types';

/**
 * Plan de envío: qué mensajes produce un `BookingPrompt` en el canal nativo.
 *
 * Es una función pura, separada del envío, por dos razones. Se puede testear sin
 * tocar la red, y el registro en el historial describe exactamente los mismos
 * mensajes que se mandaron, en vez de una reconstrucción aproximada.
 */
export type BookingMessagePlan =
  | { component: 'text'; kind: BookingPrompt['kind']; body: string }
  | {
      component: 'buttons';
      kind: BookingPrompt['kind'];
      body: string;
      options: BookingOption[];
    }
  | {
      component: 'list';
      kind: BookingPrompt['kind'];
      body: string;
      buttonText: string;
      options: BookingOption[];
    };

export function planBookingPrompt(prompt: BookingPrompt): BookingMessagePlan[] {
  switch (prompt.kind) {
    case 'ASK_DATE':
      return [
        list(
          prompt.kind,
          '¿Para qué día lo querés?',
          'Elegir día',
          prompt.options,
        ),
      ];

    case 'ASK_CATEGORY':
      // El texto no nombra las categorías: dice qué se está eligiendo. "Elegí
      // una categoría" es jerga del panel; el cliente está buscando un servicio
      // y esto es el atajo para encontrarlo.
      return [
        list(
          prompt.kind,
          '¿Qué tipo de servicio buscás?',
          'Ver opciones',
          prompt.options,
        ),
      ];

    case 'ASK_SERVICE':
      return [
        list(
          prompt.kind,
          `¿Qué servicio te gustaría agendar?`,
          'Ver servicios',
          prompt.options,
        ),
      ];

    case 'ASK_STAFF':
      return [
        list(
          prompt.kind,
          '¿Tenes algun profesional de preferencia?',
          'Ver profesionales',
          prompt.options,
        ),
      ];

    case 'ASK_SLOT':
      // Un día sin cupo no corta el flujo: se dice que no hay y se ofrece el
      // desvío a otra fecha, que viene en las opciones.
      return [
        list(
          prompt.kind,
          slotStepBody(prompt),
          prompt.hasSlots ? 'Ver horarios' : 'Ver opciones',
          prompt.options,
        ),
      ];

    case 'CONFIRM':
      return [
        buttons(
          prompt.kind,
          `Revisa tu turno antes de confirmarlo:\n\n${describeSummary(prompt.summary)}`,
          prompt.options,
        ),
      ];

    case 'COMPLETED':
      return [
        text(
          prompt.kind,
          `${
            prompt.edited
              ? '¡Listo! Cambié tu turno.'
              : '¡Listo! Tu turno quedó agendado.'
          }\n\n${describeSummary(prompt.summary)}`,
        ),
      ];

    case 'CANCELLED':
      return [
        text(
          prompt.kind,
          'Cancelé la reserva. Si queres agendar en otro momento, escríbeme y empezamos de nuevo.',
        ),
      ];

    case 'EXPIRED':
      return [
        text(
          prompt.kind,
          'Pasó un rato sin actividad, así que cerré la reserva que habíamos empezado. Escríbeme y la retomamos desde el principio.',
        ),
      ];

    case 'STALE':
      return [
        text(
          prompt.kind,
          'Esa opción ya no está vigente. Escríbeme para empezar una reserva nueva.',
        ),
      ];

    case 'NO_AVAILABILITY':
      return [text(prompt.kind, noAvailabilityText(prompt.scope))];

    case 'SLOT_TAKEN':
      // Dos mensajes a propósito: primero la explicación, después la lista nueva.
      // Meterlo todo en el body de la lista haría que el aviso pase inadvertido.
      return [
        text(
          prompt.kind,
          'Justo tomaron ese horario mientras elegías. Estos son los que quedan disponibles.',
        ),
        list(
          prompt.kind,
          `Horarios disponibles para el ${formatDate(prompt.date)}.`,
          'Ver horarios',
          prompt.options,
        ),
      ];

    case 'FROZEN':
      // Congelamiento: el texto libre no se interpreta, pero tampoco se ignora.
      return [
        text(
          prompt.kind,
          'Estamos completando tu reserva. Usa las opciones del mensaje para continuar, o toca "Cancelar" si prefieres dejarlo.',
        ),
        ...planBookingPrompt(prompt.current),
      ];

    case 'NONE':
      return [];
  }
}

/**
 * Qué dice el paso de horarios, que es dos pantallas con la misma cara.
 *
 * Elegir un rato del día no saca del paso, así que sin esto la segunda pantalla
 * repetía "estos son los horarios disponibles para el jueves 24" y el cliente se
 * quedaba con la duda de si el flujo había entendido su elección.
 *
 * Dentro de un rato no se repite la fecha: ya la eligió dos pantallas atrás, y
 * lo único que cambió —y lo único que hace falta para decidir— es el rato.
 *
 * Cuando el día viene agrupado, las filas son ratos y no horarios, y eso hay que
 * decirlo acá: se probó ponerlo en los encabezados de las secciones y no se
 * leen. Lo que se lee es este texto, porque aparece en el chat; la lista hay que
 * abrirla.
 */
function slotStepBody(
  prompt: Extract<BookingPrompt, { kind: 'ASK_SLOT' }>,
): string {
  if (!prompt.hasSlots) {
    return `No quedan horarios para el ${formatDate(prompt.date)}. ¿Querés ver otro día?`;
  }

  if (prompt.range) {
    return `Elegí un horario entre las ${prompt.range.from} y las ${prompt.range.to}.`;
  }

  /*
   * Con la lista agrupada, las filas son ratos del día y no horarios. Decirlo
   * acá es lo único que funciona: el texto del mensaje se lee en el chat, y los
   * títulos de las secciones —que viven dentro del desplegable— no.
   */
  if (prompt.grouped) {
    return `Hay varios horarios para el ${formatDate(prompt.date)}. ¿Más o menos a qué hora te queda mejor?`;
  }

  return `Estos son los horarios disponibles para el ${formatDate(prompt.date)}.`;
}

function text(kind: BookingPrompt['kind'], body: string): BookingMessagePlan {
  return { component: 'text', kind, body };
}

function buttons(
  kind: BookingPrompt['kind'],
  body: string,
  options: BookingOption[],
): BookingMessagePlan {
  return { component: 'buttons', kind, body, options };
}

/**
 * Una lista sin opciones sería un componente vacío que WhatsApp rechaza. No
 * debería ocurrir —el flujo devuelve `NO_AVAILABILITY` en ese caso— pero es
 * preferible degradar a texto que dejar al cliente sin respuesta.
 */
function list(
  kind: BookingPrompt['kind'],
  body: string,
  buttonText: string,
  options: BookingOption[],
): BookingMessagePlan {
  if (options.length === 0) {
    return text(
      kind,
      'No encontré opciones disponibles en este momento. Escríbeme e intentamos de nuevo.',
    );
  }
  return { component: 'list', kind, body, buttonText, options };
}

/**
 * Los tres casos son finales del flujo, así que el texto tiene que decir qué
 * hacer después. `SETUP` no es falta de cupo sino de configuración: pasa con un
 * negocio recién creado, sin servicios cargados o sin nadie asignado a ellos.
 */
function noAvailabilityText(scope: 'SETUP' | 'SERVICE' | 'STAFF'): string {
  switch (scope) {
    case 'SETUP':
      return 'Todavía no tengo los servicios cargados para poder agendar. Avisale al equipo y lo resolvemos.';
    case 'SERVICE':
      return 'Ese servicio no tiene a nadie asignado por ahora. Avisale al equipo y lo resolvemos.';
    case 'STAFF':
      return 'Ese profesional no tiene horarios disponibles. Escribime y buscamos otra opción.';
  }
}

/** `YYYY-MM-DD` a "viernes 31 de julio", sin depender de la zona horaria. */
export function formatDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;

  const [year, month, day] = date.split('-').map(Number);
  const reference = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(reference);
}

function describeSummary(summary: BookingSummary): string {
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: summary.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(summary.startTime);

  const lines = [
    `Servicio: ${summary.serviceName} (${summary.serviceDurationMinutes} min)`,
    `Día: ${formatDate(summary.date)}`,
    `Hora: ${time}`,
  ];

  if (summary.staffName) lines.push(`Profesional: ${summary.staffName}`);

  return lines.join('\n');
}

/**
 * Texto con el que el mensaje queda registrado en el historial.
 *
 * Incluye las opciones ofrecidas porque el panel de la barbería muestra solo
 * `content`: sin ellas, una lista se vería como una pregunta sin respuestas
 * posibles y el hilo resultaría incomprensible.
 */
export function planToTranscript(plan: BookingMessagePlan): string {
  if (plan.component === 'text') return plan.body;

  const titles = plan.options.map((option) => option.title).join(' · ');
  return `${plan.body}\n\nOpciones: ${titles}`;
}
