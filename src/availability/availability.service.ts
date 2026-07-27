import { Injectable } from '@nestjs/common';
import { AvailabilityCalculator } from './availability.calculator';
import { AvailabilityRepository } from './availability.repository';
import type {
  AvailabilityResult,
  BookingRejectionReason,
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
      return this.reject('INVALID_INPUT_DATA', 'Servicios inválidos o vacíos');
    }

    const tenant = await this.availabilityRepository.getTenant(input.tenantId);
    if (!tenant) {
      return this.reject('INVALID_TENANT', 'Tenant inválido');
    }

    const timeZone = tenant.timezone;
    if (!timeZone) {
      return this.reject('INVALID_TENANT', 'Tenant sin zona horaria');
    }

    const nowFormatted = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    const [todayDate, nowTime] = nowFormatted.split(', ');

    const desiredDate = input.desiredDate || todayDate;
    const desiredTime = input.desiredTime || nowTime;
    const hasDesiredTime = Boolean(input.desiredTime);

    const dayOfWeek = getDayOfWeek(desiredDate, timeZone);
    const businessHours = await this.availabilityRepository.getBusinessHours(
      input.tenantId,
      dayOfWeek,
    );
    if (businessHours.length === 0) {
      return this.reject(
        'OUTSIDE_BUSINESS_HOURS',
        'El día solicitado no tiene horario de atención configurado',
      );
    }

    const desiredStart = makeDateInTimeZone(desiredDate, desiredTime, timeZone);

    const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
      businessHours,
      desiredDate,
      timeZone,
      totalDuration,
    );

    const allAvailableSlots: StaffSlot[] = [];

    const staffList = await this.availabilityRepository.getStaffList(
      input.tenantId,
      input.serviceIds,
      input.staffId,
    );

    if (staffList.length > 0) {
      for (const staff of staffList) {
        const appointments = await this.availabilityRepository.getAppointments(
          input.tenantId,
          desiredDate,
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
        return this.reject(
          'STAFF_NOT_FOUND',
          'No hay staff activo disponible para los servicios solicitados',
        );
      }

      const appointmentsByStaff =
        await this.availabilityRepository.getAppointmentsByStaff(
          input.tenantId,
          desiredDate,
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
      return this.reject(
        'STAFF_CANNOT_PERFORM_SERVICE',
        'No hay staff que pueda realizar todos los servicios solicitados',
      );
    }

    const nowInTenantTz = makeDateInTimeZone(todayDate, nowTime, timeZone);
    const minStartTime = new Date(nowInTenantTz.getTime() + 15 * 60_000);

    const futureSlots = allAvailableSlots.filter(
      (slot) => slot.startTime >= minStartTime,
    );

    const uniqueSlots: StaffSlot[] = [];
    const seen = new Set<number>();
    for (const slot of futureSlots) {
      const key = slot.startTime.getTime();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueSlots.push(slot);
    }

    const minGapMs = 30 * 60_000;
    const pickWithGap = (slots: StaffSlot[], limit: number): StaffSlot[] => {
      const picked: StaffSlot[] = [];
      for (const slot of slots) {
        if (
          picked.every(
            (p) =>
              Math.abs(p.startTime.getTime() - slot.startTime.getTime()) >=
              minGapMs,
          )
        ) {
          picked.push(slot);
        }
        if (picked.length >= limit) break;
      }
      return picked;
    };

    let selected: StaffSlot[] = [];

    if (hasDesiredTime) {
      const exactMatch = uniqueSlots.find((slot) =>
        this.availabilityCalculator.isExactMatch(slot, desiredStart),
      );

      const desiredHour = desiredStart.getHours();
      const desiredMinute = desiredStart.getMinutes();
      const isTargetTime =
        (desiredHour === 8 && desiredMinute === 0) ||
        (desiredHour === 7 && desiredMinute === 0);

      if (exactMatch && !isTargetTime) {
        return {
          isAvailable: true,
          suggestedSlots: [
            this.availabilityCalculator.toSuggestedSlot(exactMatch),
          ],
        };
      }
      const closest = this.availabilityCalculator.findClosestSlots(
        uniqueSlots,
        desiredStart,
        uniqueSlots.length,
      );
      selected = pickWithGap(closest, 3);
    } else {
      const elegantSlots = uniqueSlots.filter(
        (slot) => slot.startTime.getMinutes() % 10 === 0,
      );
      const sorted = [...elegantSlots].sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
      );
      const noon = makeDateInTimeZone(desiredDate, '12:00', timeZone);
      const morning = sorted.filter((s) => s.startTime < noon);
      const afternoon = sorted.filter((s) => s.startTime >= noon);

      if (morning.length > 0) {
        selected = pickWithGap(morning, 3);
      }

      if (selected.length < 3 && afternoon.length > 0) {
        selected = [
          ...selected,
          ...pickWithGap(afternoon, 3 - selected.length),
        ];
      }
    }

    return {
      isAvailable: selected.length > 0,
      suggestedSlots: selected
        .slice(0, 3)
        .map((slot) => this.availabilityCalculator.toSuggestedSlot(slot)),
      ...(selected.length === 0
        ? {
            rejectionReason: 'NO_AVAILABLE_SLOT' as BookingRejectionReason,
            rejectionMessage: 'No hay disponibilidad para ese horario',
          }
        : {}),
    };
  }

  async getFriendlySlots(input: FindAvailableSlotsInput): Promise<{
    isAvailable: boolean;
    friendlySlots: string[];
  }> {
    const availability = await this.findAvailableSlots(input);
    return this.getFriendlySlotsFromAvailability(availability, input.tenantId);
  }

  async getFriendlySlotsFromAvailability(
    availability: AvailabilityResult,
    tenantId: string,
  ): Promise<{
    isAvailable: boolean;
    friendlySlots: string[];
  }> {
    const tenant = await this.availabilityRepository.getTenant(tenantId);
    const timeZone = tenant?.timezone ?? 'America/La_Paz';

    const friendlySlots = normalizeSlots(availability.suggestedSlots, timeZone);
    console.log('[availability] friendlySlots count:', friendlySlots.length);
    console.log('[availability] friendlySlots:', friendlySlots);

    return {
      isAvailable: availability.isAvailable,
      friendlySlots,
    };
  }

  private reject(
    reason: BookingRejectionReason,
    message: string,
  ): AvailabilityResult {
    return {
      isAvailable: false,
      suggestedSlots: [],
      rejectionReason: reason,
      rejectionMessage: message,
    };
  }
}
