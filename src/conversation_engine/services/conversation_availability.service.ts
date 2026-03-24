import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Appointment,
  AppointmentStatus,
} from '../../appointments/entities/appointment.entity';
import { BusinessHour } from '../../business_hours/entities/business_hour.entity';

@Injectable()
export class ConversationAvailabilityService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(BusinessHour)
    private readonly businessHourRepository: Repository<BusinessHour>,
  ) {}

  async isSlotAvailable(
    tenantId: string,
    start: Date,
    end: Date,
    timezone?: string,
  ) {
    const hasHours = await this.isWithinBusinessHours(
      tenantId,
      start,
      end,
      timezone,
    );
    if (!hasHours) {
      return false;
    }

    const overlapCount = await this.appointmentRepository
      .createQueryBuilder('appointment')
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.status != :status', {
        status: AppointmentStatus.CANCELLED,
      })
      .andWhere('appointment.startTime < :end', { end })
      .andWhere('appointment.endTime > :start', { start })
      .getCount();

    return overlapCount === 0;
  }

  async getAlternativeTimes(input: {
    tenantId: string;
    start: Date;
    durationMinutes: number;
    limit: number;
    stepMinutes?: number;
    timezone?: string;
  }) {
    const step = input.stepMinutes ?? 30;
    const dayHours = await this.getBusinessHoursForDate(
      input.tenantId,
      input.start,
      input.timezone,
    );
    if (!dayHours.length) {
      return [];
    }

    const slots: Date[] = [];
    for (const hours of dayHours) {
      const intervalStart = combineDateAndTime(input.start, hours.startTime);
      const intervalEnd = combineDateAndTime(input.start, hours.endTime);
      let cursor = new Date(intervalStart);
      while (
        cursor.getTime() + input.durationMinutes * 60 * 1000 <=
        intervalEnd.getTime()
      ) {
        slots.push(new Date(cursor));
        cursor = addMinutes(cursor, step);
      }
    }

    const available: Date[] = [];
    for (const slot of slots) {
      const end = addMinutes(slot, input.durationMinutes);
      const ok = await this.isSlotAvailable(
        input.tenantId,
        slot,
        end,
        input.timezone,
      );
      if (ok) {
        available.push(slot);
      }
    }

    return pickClosestTimes(available, input.start, input.limit);
  }

  private async isWithinBusinessHours(
    tenantId: string,
    start: Date,
    end: Date,
    timezone?: string,
  ) {
    const dayHours = await this.getBusinessHoursForDate(
      tenantId,
      start,
      timezone,
    );
    if (!dayHours.length) {
      return false;
    }
    const startMinutes = getTimeMinutes(start, timezone);
    const endMinutes = getTimeMinutes(end, timezone);
    return dayHours.some((hours) => {
      const rangeStart = timeToMinutes(hours.startTime);
      const rangeEnd = timeToMinutes(hours.endTime);
      return startMinutes >= rangeStart && endMinutes <= rangeEnd;
    });
  }

  private async getBusinessHoursForDate(
    tenantId: string,
    date: Date,
    timezone?: string,
  ) {
    const dayOfWeek = getZonedDayOfWeek(date, timezone);
    return this.businessHourRepository.find({
      where: { tenantId, dayOfWeek },
    });
  }

  formatTodayInZone(timezone?: string) {
    return formatTodayInZone(timezone);
  }
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map((v) => Number(v));
  return (hour || 0) * 60 + (minute || 0);
}

function getTimeMinutes(date: Date, timezone?: string) {
  if (!timezone) {
    return date.getHours() * 60 + date.getMinutes();
  }
  const parts = getZonedParts(date, timezone);
  return parts.hour * 60 + parts.minute;
}

function combineDateAndTime(date: Date, time: string) {
  const [hour, minute, second] = time.split(':').map((v) => Number(v));
  const combined = new Date(date);
  combined.setHours(hour || 0, minute || 0, second || 0, 0);
  return combined;
}

function addMinutes(date: Date, minutes: number) {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

function pickClosestTimes(times: Date[], target: Date, limit: number) {
  return [...times]
    .sort((a, b) => {
      const diffA = Math.abs(a.getTime() - target.getTime());
      const diffB = Math.abs(b.getTime() - target.getTime());
      if (diffA !== diffB) return diffA - diffB;
      return a.getTime() - b.getTime();
    })
    .slice(0, limit);
}

function formatTodayInZone(timezone?: string) {
  const date = new Date();
  if (!timezone) {
    return date.toISOString().slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '0000';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function getZonedDayOfWeek(date: Date, timezone?: string) {
  if (!timezone || !isValidTimeZone(timezone)) {
    return date.getDay();
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? date.getDay();
}

function getZonedParts(date: Date, timezone: string) {
  if (!isValidTimeZone(timezone)) {
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  return { hour, minute };
}

function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// function normalizeTimeZone(value: unknown) {
//   if (typeof value !== 'string' || !value.trim()) {
//     return null;
//   }
//   try {
//     new Intl.DateTimeFormat('en-US', { timeZone: value });
//     return value;
//   } catch {
//     return null;
//   }
// }
