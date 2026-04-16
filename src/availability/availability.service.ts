import { Injectable } from '@nestjs/common';
import { AvailabilityCalculator } from './availability.calculator';
import { AvailabilityRepository } from './availability.repository';
import type {
  AvailabilityResult,
  FindAvailableSlotsInput,
  StaffSlot,
} from './utils/availability.types';
import {
  addMinutes,
  getDayOfWeek,
  isOverlapping,
  makeDateInTimeZone,
} from './utils/availability.helpers';
import { normalizeSlots } from './utils/availability-formatter';

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly availabilityCalculator: AvailabilityCalculator,
  ) {}

  async findAvailableSlots(
    input: FindAvailableSlotsInput,
  ): Promise<AvailabilityResult> {
    const services = await this.availabilityRepository.getServices(
      input.tenantId,
      input.serviceIds,
    );
    const totalDuration =
      this.availabilityCalculator.calculateTotalDuration(services);

    if (totalDuration <= 0) {
      return { isAvailable: false, suggestedSlots: [] };
    }

    const tenant = await this.availabilityRepository.getTenant(input.tenantId);
    if (!tenant) {
      return { isAvailable: false, suggestedSlots: [] };
    }

    const timeZone = tenant.timezone;

    const dayOfWeek = getDayOfWeek(input.desiredDate, timeZone);
    const businessHours = await this.availabilityRepository.getBusinessHours(
      input.tenantId,
      dayOfWeek,
    );
    if (businessHours.length === 0) {
      return { isAvailable: false, suggestedSlots: [] };
    }

    const desiredStart = makeDateInTimeZone(
      input.desiredDate,
      input.desiredTime,
      timeZone,
    );

    const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
      businessHours,
      input.desiredDate,
      timeZone,
      totalDuration,
    );

    const allAvailableSlots: StaffSlot[] = [];

    const staffListSingle = await this.availabilityRepository.getStaffList(
      input.tenantId,
      input.serviceIds,
      input.staffId,
    );

    if (staffListSingle.length > 0) {
      for (const staff of staffListSingle) {
        const appointments = await this.availabilityRepository.getAppointments(
          input.tenantId,
          input.desiredDate,
          timeZone,
          staff.id,
        );

        const availableSlots = this.availabilityCalculator.filterAvailableSlots(
          candidateSlots,
          appointments,
        );

        for (const slot of availableSlots) {
          allAvailableSlots.push({
            startTime: slot.startTime,
            endTime: slot.endTime,
            staffId: staff.id,
            staffName: staff.name,
          });
        }
      }
    } else if (!input.staffId && input.serviceIds.length > 1) {
      const staffCandidates =
        await this.availabilityRepository.getActiveStaffWithServices(
          input.tenantId,
        );
      if (staffCandidates.length === 0) {
        return { isAvailable: false, suggestedSlots: [] };
      }

      const appointmentsByStaff =
        await this.availabilityRepository.getAppointmentsByStaff(
          input.tenantId,
          input.desiredDate,
          timeZone,
          staffCandidates.map((s) => s.id),
        );

      const serviceById = new Map(services.map((s) => [s.id, s]));
      const orderedServiceIds = input.serviceIds.filter((id) =>
        serviceById.has(id),
      );

      const canStaffDoService = (
        staff: { services?: { id: string }[] },
        serviceId: string,
      ) => {
        const ids = staff.services?.map((s) => s.id) ?? [];
        return ids.includes(serviceId);
      };

      const isStaffFree = (staffId: string, startTime: Date, endTime: Date) => {
        const appts = appointmentsByStaff[staffId] ?? [];
        return !appts.some((a) =>
          isOverlapping(a.startTime, a.endTime, startTime, endTime),
        );
      };

      for (const slot of candidateSlots) {
        let currentStart = slot.startTime;
        const segments: NonNullable<StaffSlot['segments']> = [];

        let failed = false;
        for (const serviceId of orderedServiceIds) {
          const service = serviceById.get(serviceId);
          const durationMinutes = service?.durationMinutes ?? 0;
          if (durationMinutes <= 0) {
            failed = true;
            break;
          }

          const segmentEnd = addMinutes(currentStart, durationMinutes);

          const staffForSegment = staffCandidates.find(
            (s) =>
              canStaffDoService(s, serviceId) &&
              isStaffFree(s.id, currentStart, segmentEnd),
          );

          if (!staffForSegment) {
            failed = true;
            break;
          }

          segments.push({
            serviceId,
            staffId: staffForSegment.id,
            staffName: staffForSegment.name,
            startTime: currentStart,
            endTime: segmentEnd,
          });
          currentStart = segmentEnd;
        }

        if (failed || segments.length !== orderedServiceIds.length) continue;

        const primary = segments[0];
        allAvailableSlots.push({
          startTime: slot.startTime,
          endTime: slot.endTime,
          staffId: primary.staffId,
          staffName: primary.staffName,
          segments,
        });
      }
    } else {
      return { isAvailable: false, suggestedSlots: [] };
    }

    const exactMatch = allAvailableSlots.find((slot) =>
      this.availabilityCalculator.isExactMatch(slot, desiredStart),
    );

    if (exactMatch) {
      return {
        isAvailable: true,
        suggestedSlots: [
          this.availabilityCalculator.toSuggestedSlot(exactMatch),
        ],
      };
    }

    const closestSlots = this.availabilityCalculator.findClosestSlots(
      allAvailableSlots,
      desiredStart,
      10,
    );

    return {
      isAvailable: false,
      suggestedSlots: closestSlots.map((slot) =>
        this.availabilityCalculator.toSuggestedSlot(slot),
      ),
    };
  }

  async getFriendlySlots(input: FindAvailableSlotsInput): Promise<{
    isAvailable: boolean;
    friendlySlots: string[];
  }> {
    const availability = await this.findAvailableSlots(input);
    const tenant = await this.availabilityRepository.getTenant(input.tenantId);
    const timeZone = tenant?.timezone ?? 'America/La_Paz';

    const friendlySlots = normalizeSlots(availability.suggestedSlots, timeZone);
    console.log('[availability] friendlySlots count:', friendlySlots.length);
    console.log('[availability] friendlySlots:', friendlySlots);

    return {
      isAvailable: availability.isAvailable,
      friendlySlots,
    };
  }
}
