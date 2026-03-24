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
    maxDaysAhead?: number;
  }) {
    const step = input.durationMinutes;
    const maxDaysAhead = input.maxDaysAhead ?? 3;
    const now = new Date();

    const allAvailable: Date[] = [];

    for (let offset = 0; offset <= maxDaysAhead; offset += 1) {
      const day = addDays(input.start, offset);

      const dayHours = await this.getBusinessHoursForDate(
        input.tenantId,
        day,
        input.timezone,
      );

      if (!dayHours.length) continue;

      for (const hours of dayHours) {
        const intervalStart = combineDateAndTime(
          day,
          hours.startTime,
          input.timezone,
        );

        const intervalEnd = combineDateAndTime(
          day,
          hours.endTime,
          input.timezone,
        );

        let cursor = new Date(intervalStart);

        while (
          cursor.getTime() + input.durationMinutes * 60 * 1000 <=
          intervalEnd.getTime()
        ) {
          if (!isPastSlot(cursor, now, input.timezone)) {
            const end = addMinutes(cursor, input.durationMinutes);

            const ok = await this.isSlotAvailable(
              input.tenantId,
              cursor,
              end,
              input.timezone,
            );

            if (ok) {
              allAvailable.push(new Date(cursor));
            }
          }

          cursor = addMinutes(cursor, step);
        }
      }
    }

    if (!allAvailable.length) return [];

    return pickClosestTimes(allAvailable, input.start, input.limit);
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
    const primary = await this.businessHourRepository.find({
      where: { tenantId, dayOfWeek },
    });
    if (primary.length || !timezone) {
      return primary;
    }
    const fallbackDay = getZonedDayOfWeek(date, undefined);
    return this.businessHourRepository.find({
      where: { tenantId, dayOfWeek: fallbackDay },
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

function combineDateAndTime(date: Date, time: string, timezone?: string) {
  const [hour, minute, second] = time.split(':').map((v) => Number(v));
  const dateKey = getZonedDateKey(date, timezone);
  const offset = timezone ? getTimeZoneOffset(date, timezone) : null;
  const iso = `${dateKey}T${String(hour || 0).padStart(2, '0')}:${String(
    minute || 0,
  ).padStart(2, '0')}:${String(second || 0).padStart(2, '0')}${offset ?? ''}`;
  return new Date(iso);
}

function addMinutes(date: Date, minutes: number) {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
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
  return getZonedDateKey(date, timezone);
}

function getZonedDateKey(date: Date, timezone?: string) {
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

function getTimeZoneOffset(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tz) {
      return null;
    }
    const match = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!match) {
      return null;
    }
    const hours = match[1].padStart(3, '0');
    const minutes = match[2] ?? '00';
    return `${hours}:${minutes}`;
  } catch {
    return null;
  }
}

function isPastSlot(slot: Date, now: Date, timezone?: string) {
  const slotKey = getZonedDateKey(slot, timezone);
  const nowKey = getZonedDateKey(now, timezone);
  if (slotKey !== nowKey) {
    return false;
  }
  const slotMinutes = getTimeMinutes(slot, timezone);
  const nowMinutes = getTimeMinutes(now, timezone);
  return slotMinutes <= nowMinutes;
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
