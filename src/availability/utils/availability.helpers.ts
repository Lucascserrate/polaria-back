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
  };
};

export const makeDateInTimeZone = (date: string, time: string): Date => {
  return new Date(`${date}T${time}:00`);
};

export const getDayOfWeek = (date: string, timeZone: string): number => {
  const reference = makeDateInTimeZone(date, '12:00');
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(reference);
  const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Math.max(0, map.indexOf(day));
};
