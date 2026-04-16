import type { StaffSlot, SuggestedSlot } from './availability.types';

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60_000);
};

export const normalizeTime = (time: string): string => {
  const [h = '00', m = '00'] = time.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
};

export const isOverlapping = (
  existingStart: Date,
  existingEnd: Date,
  newStart: Date,
  newEnd: Date,
): boolean => {
  return existingStart < newEnd && existingEnd > newStart;
};

export const findClosestSlots = (
  slots: StaffSlot[],
  desiredStart: Date,
  limit: number,
): StaffSlot[] => {
  return [...slots]
    .sort((a, b) => {
      const diffA = Math.abs(a.startTime.getTime() - desiredStart.getTime());
      const diffB = Math.abs(b.startTime.getTime() - desiredStart.getTime());
      if (diffA !== diffB) return diffA - diffB;
      return a.startTime.getTime() - b.startTime.getTime();
    })
    .slice(0, limit);
};

export const toSuggestedSlot = (slot: StaffSlot): SuggestedSlot => {
  return {
    startTime: slot.startTime.toISOString(),
    endTime: slot.endTime.toISOString(),
    staffId: slot.staffId,
    staffName: slot.staffName,
    segments: slot.segments?.map((s) => ({
      serviceId: s.serviceId,
      staffId: s.staffId,
      staffName: s.staffName,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
    })),
  };
};

export const makeDateInTimeZone = (
  date: string,
  time: string,
  timeZone: string,
): Date => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offsetMinutes * 60_000);
};

export const getDayOfWeek = (date: string, timeZone: string): number => {
  const reference = makeDateInTimeZone(date, '12:00', timeZone);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(reference);
  const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Math.max(0, map.indexOf(day));
};

const getTimeZoneOffset = (date: Date, timeZone: string): number => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value || '0');

  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return (asUTC - date.getTime()) / 60_000;
};
