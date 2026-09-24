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
   * **Además del paso regular, cada franja aporta el horario que termina justo
   * al cierre.** Es el único candidato que puede no estar alineado con el paso, y
   * existe porque la grilla arranca en la apertura: un local que abre 09:00 y
   * cierra 18:15, con paso de media hora y un servicio de 30 minutos, llega hasta
   * las 17:30 y deja fuera las 17:45, que entran enteras. Esos minutos del final
   * no son un detalle: son el rato que el negocio agregó **a propósito** al
   * correr su cierre a las 18:15 para poder atender a alguien más, y el sistema
   * los estaba tirando.
   *
   * Se nota sobre todo tarde, porque ahí es lo único que queda: a las 17:30, con
   * el piso de anticipación en 17:45, el último horario de la grilla ya pasó y el
   * siguiente no entra antes de cerrar. La respuesta era "no quedan horarios" con
   * el local abierto y el equipo libre.
   */
  generateCandidateSlots(
    workingRanges: SlotRange[],
    durationMinutes: number,
    // El flujo guiado usa un paso más grueso; el conversacional necesitaba 5
    // para poder buscar el horario más cercano al que pedía el usuario.
    stepMinutes = 5,
    /**
     * Genera también los que **empiezan** dentro de la franja aunque terminen
     * después.
     *
     * Sólo lo pide el panel: un servicio de una hora a las 16:30 con cierre a
     * las 17:00 es una decisión legítima del negocio —se queda media hora más—,
     * y no ofrecerlo era obligar a mover el horario de atención para agendarlo.
     * A un cliente se le sigue ofreciendo únicamente lo que entra entero.
     */
    allowOverflow = false,
  ): SlotRange[] {
    const slots: SlotRange[] = [];

    for (const range of workingRanges) {
      let slotStart = range.startTime;
      const fits = () =>
        allowOverflow
          ? slotStart < range.endTime
          : addMinutes(slotStart, durationMinutes) <= range.endTime;

      while (fits()) {
        const slotEnd = addMinutes(slotStart, durationMinutes);
        slots.push({ startTime: slotStart, endTime: slotEnd });
        slotStart = addMinutes(slotStart, stepMinutes);
      }

      /*
       * El que termina exactamente al cierre.
       *
       * Se omite si no entra en la franja —una franja más corta que el servicio
       * no da para nada— y si el paso ya lo generó, que es lo que pasa cuando la
       * franja cierra en una hora redonda.
       */
      const lastStart = addMinutes(range.endTime, -durationMinutes);

      if (
        lastStart >= range.startTime &&
        !slots.some((slot) => slot.startTime.getTime() === lastStart.getTime())
      ) {
        slots.push({ startTime: lastStart, endTime: range.endTime });
      }
    }

    /*
     * Por instante y no por orden de armado: el horario de cierre de una franja
     * puede caer antes que el último que generó el paso —pasa cuando la franja
     * dura menos que dos servicios— y una grilla desordenada deja la lista de
     * horarios desordenada, que es lo primero que se ve.
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
