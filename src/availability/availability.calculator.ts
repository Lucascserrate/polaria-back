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
   */
  generateCandidateSlots(
    workingRanges: SlotRange[],
    durationMinutes: number,
    // El flujo guiado usa un paso más grueso; el conversacional necesitaba 5
    // para poder buscar el horario más cercano al que pedía el usuario.
    stepMinutes = 5,
  ): SlotRange[] {
    const slots: SlotRange[] = [];

    for (const range of workingRanges) {
      let slotStart = range.startTime;
      while (addMinutes(slotStart, durationMinutes) <= range.endTime) {
        const slotEnd = addMinutes(slotStart, durationMinutes);
        slots.push({ startTime: slotStart, endTime: slotEnd });
        slotStart = addMinutes(slotStart, stepMinutes);
      }
    }

    return slots;
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
