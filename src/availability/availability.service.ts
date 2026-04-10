import { Injectable } from '@nestjs/common';
import { AvailabilityCalculator } from './availability.calculator';
import { AvailabilityRepository } from './availability.repository';
import type {
  AvailabilityResult,
  FindAvailableSlotsInput,
  StaffSlot,
} from './utils/availability.types';
import { getDayOfWeek, makeDateInTimeZone } from './utils/availability.helpers';
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
    if (!timeZone) {
      return { isAvailable: false, suggestedSlots: [] };
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
      return { isAvailable: false, suggestedSlots: [] };
    }

    const staffList = await this.availabilityRepository.getStaffList(
      input.tenantId,
      input.staffId,
    );
    if (staffList.length === 0) {
      return { isAvailable: false, suggestedSlots: [] };
    }

    const desiredStart = makeDateInTimeZone(desiredDate, desiredTime, timeZone);

    const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
      businessHours,
      desiredDate,
      timeZone,
      totalDuration,
    );

    const allAvailableSlots: StaffSlot[] = [];

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
}
