import { Injectable } from '@nestjs/common';
import { AvailabilityCalculator } from './availability.calculator';
import { AvailabilityRepository } from './availability.repository';
import type {
  AvailabilityResult,
  FindAvailableSlotsInput,
  StaffSlot,
} from './utils/availability.types';
import { getDayOfWeek, makeDateInTimeZone } from './utils/availability.helpers';

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

    const staffList = await this.availabilityRepository.getStaffList(
      input.tenantId,
      input.staffId,
    );
    if (staffList.length === 0) {
      return { isAvailable: false, suggestedSlots: [] };
    }

    const desiredStart = makeDateInTimeZone(
      input.desiredDate,
      input.desiredTime,
    );

    const candidateSlots = this.availabilityCalculator.generateCandidateSlots(
      businessHours,
      input.desiredDate,
      totalDuration,
    );

    const allAvailableSlots: StaffSlot[] = [];

    for (const staff of staffList) {
      const appointments = await this.availabilityRepository.getAppointments(
        input.tenantId,
        input.desiredDate,
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
      3,
    );

    return {
      isAvailable: false,
      suggestedSlots: closestSlots.map((slot) =>
        this.availabilityCalculator.toSuggestedSlot(slot),
      ),
    };
  }
}
