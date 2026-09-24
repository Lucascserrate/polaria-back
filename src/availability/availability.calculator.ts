import { Injectable } from '@nestjs/common';
import type {
  SlotRange,
  StaffSlot,
  SuggestedSlot,
} from './utils/availability.types';
import {
  addMinutes,
  findClosestSlots,
  isOverlapping,
  toSuggestedSlot,
} from './utils/availability.helpers';

@Injectable()
export class AvailabilityCalculator {
  calculateTotalDuration(services: { durationMinutes: number }[]): number {
    return services.reduce(
      (total, service) => total + (service.durationMinutes || 0),
      0,
    );
  }

  /**
   * Grilla de horarios posibles dentro de las franjas de trabajo recibidas.
   *
   * Las franjas ya vienen resueltas a instantes absolutos por
   * `resolveWorkingRanges`, así que acá no se conoce la zona horaria ni de quién
   * es el horario: puede ser el del negocio o la cobertura combinada del equipo.
   *
   * La grilla regular se completa con dos clases de horarios que el paso no
   * puede producir y que son capacidad real del negocio:
   *
   * 1. **El que termina justo al cierre de cada franja.** La grilla arranca en
   *    la apertura, así que un local que abre 09:00 y cierra 18:15, con paso de
   *    media hora y un servicio de 30 minutos, llega hasta las 17:30 y deja
   *    fuera las 17:45, que entran enteras. Esos minutos son el rato que el
   *    negocio agregó a propósito al correr su cierre, y se estaban tirando.
   *
   * 2. **Los `anchors`**, que es donde termina cada cita ya agendada. Sin ellos
   *    el hueco que deja un servicio que no dura un múltiplo del paso no se
   *    puede llenar: con citas de 20 minutos, la primera termina 09:20 y el
   *    siguiente horario de la grilla es 09:30, así que se pierden 10 minutos
   *    por cita. En una jornada de diez horas eso son diez citas que no entran
   *    de un día que sí las aguantaba.
   */
  generateCandidateSlots(input: {
    workingRanges: SlotRange[];
    durationMinutes: number;
    /**
     * Cada cuánto ofrecer un horario. Lo decide el canal, no el motor: ver
     * `DEFAULT_SLOT_STEP_MINUTES`.
     *
     * El flujo conversacional usa 5 porque busca "el más cercano a lo que pidió
     * el usuario" en vez de llenar una lista.
     */
    stepMinutes?: number;
    /**
     * Genera también los que **empiezan** dentro de la franja aunque terminen
     * después.
     *
     * Un servicio de una hora a las 21:30 con cierre a las 22:00 es una reserva
     * legítima: el negocio recibe gente hasta las 22:00 y termina lo que
     * empezó. No generarlo obligaba a cargar un horario de cierre falso para
     * poder agendar la última hora del día.
     */
    allowOverflow?: boolean;
    /**
     * Instantes en los que además se quiere un horario, si entran.
     *
     * Son los finales de las citas ya agendadas. Se pasan como instantes
     * sueltos y no como "las citas" porque acá no importa de quién son ni qué
     * servicio eran: si alguien está libre a esa hora lo decide después
     * `buildBookingSlots`, que es quien mira agenda por agenda.
     */
    anchors?: Date[];
  }): SlotRange[] {
    const {
      workingRanges,
      durationMinutes,
      stepMinutes = 5,
      allowOverflow = false,
      anchors = [],
    } = input;

    const slots: SlotRange[] = [];
    const taken = new Set<number>();

    const add = (startTime: Date) => {
      if (taken.has(startTime.getTime())) return;
      taken.add(startTime.getTime());
      slots.push({
        startTime,
        endTime: addMinutes(startTime, durationMinutes),
      });
    };

    for (const range of workingRanges) {
      let slotStart = range.startTime;
      const fits = () =>
        allowOverflow
          ? slotStart < range.endTime
          : addMinutes(slotStart, durationMinutes) <= range.endTime;

      while (fits()) {
        add(slotStart);
        slotStart = addMinutes(slotStart, stepMinutes);
      }

      // El que termina exactamente al cierre. Se omite si no entra en la franja.
      const lastStart = addMinutes(range.endTime, -durationMinutes);
      if (lastStart >= range.startTime) add(lastStart);

      /*
       * Los anclajes de esta franja. Se les exige lo mismo que a la grilla: que
       * empiecen dentro y que terminen antes de cerrar, salvo con desborde.
       */
      for (const anchor of anchors) {
        if (anchor < range.startTime || anchor >= range.endTime) continue;
        if (
          !allowOverflow &&
          addMinutes(anchor, durationMinutes) > range.endTime
        ) {
          continue;
        }
        add(anchor);
      }
    }

    /*
     * Por instante y no por orden de armado: el horario de cierre y los
     * anclajes se agregan al final de cada franja pero pueden caer en cualquier
     * lado, y una grilla desordenada deja la lista de horarios desordenada, que
     * es lo primero que se ve.
     */
    return slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  filterAvailableSlots(
    candidateSlots: SlotRange[],
    appointments: Array<{ startTime: Date; endTime: Date }>,
  ): SlotRange[] {
    if (appointments.length === 0) return candidateSlots;

    return candidateSlots.filter((slot) => {
      return !appointments.some((appointment) =>
        isOverlapping(
          appointment.startTime,
          appointment.endTime,
          slot.startTime,
          slot.endTime,
        ),
      );
    });
  }

  isExactMatch(
    slot: StaffSlot,
    desiredStart: Date,
    toleranceMinutes = 5,
  ): boolean {
    const diff = Math.abs(slot.startTime.getTime() - desiredStart.getTime());
    return diff < toleranceMinutes * 60_000;
  }

  findClosestSlots(
    slots: StaffSlot[],
    desiredStart: Date,
    limit: number,
  ): StaffSlot[] {
    return findClosestSlots(slots, desiredStart, limit);
  }

  toSuggestedSlot(slot: StaffSlot): SuggestedSlot {
    return toSuggestedSlot(slot);
  }
}
