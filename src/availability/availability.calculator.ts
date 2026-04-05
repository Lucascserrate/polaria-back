import { Injectable } from '@nestjs/common';
import type { BusinessHour } from '../business_hours/entities/business_hour.entity';
import type { Appointment } from '../appointments/entities/appointment.entity';
import type {
  SlotRange,
  StaffSlot,
  SuggestedSlot,
} from './utils/availability.types';
import {
  addMinutes,
  findClosestSlots,
  isOverlapping,
  makeDateInTimeZone,
  normalizeTime,
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

  generateCandidateSlots(
    businessHours: BusinessHour[],
    desiredDate: string,
    durationMinutes: number,
  ): SlotRange[] {
    const slots: SlotRange[] = [];
    const stepMinutes = 5;

    for (const hours of businessHours) {
      const startTime = makeDateInTimeZone(
        desiredDate,
        normalizeTime(hours.startTime),
      );
      const endTime = makeDateInTimeZone(
        desiredDate,
        normalizeTime(hours.endTime),
      );

      if (endTime <= startTime) continue;

      let slotStart = startTime;
      while (addMinutes(slotStart, durationMinutes) <= endTime) {
        const slotEnd = addMinutes(slotStart, durationMinutes);
        slots.push({ startTime: slotStart, endTime: slotEnd });
        slotStart = addMinutes(slotStart, stepMinutes);
      }
    }

    return slots;
  }

  filterAvailableSlots(
    candidateSlots: SlotRange[],
    appointments: Appointment[],
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
