import type { SuggestedSlot } from './availability.types';

const roundUpMinutes = (minutes: number, interval: number): number => {
  return Math.ceil(minutes / interval) * interval;
};

const getLocalTimeParts = (
  date: Date,
  timeZone: string,
): {
  hour: number;
  minute: number;
} => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value || '0');
  return { hour: get('hour'), minute: get('minute') };
};

const formatHHmm = (hour: number, minute: number): string => {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${hh}:${mm}`;
};

export const normalizeSlots = (
  slots: SuggestedSlot[],
  timeZone: string,
  intervalMinutes = 15,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const slot of slots) {
    const { hour, minute } = getLocalTimeParts(
      new Date(slot.startTime),
      timeZone,
    );
    const roundedMinutes = roundUpMinutes(minute, intervalMinutes);
    const carry = roundedMinutes === 60 ? 1 : 0;
    const finalHour = (hour + carry) % 24;
    const finalMinute = roundedMinutes === 60 ? 0 : roundedMinutes;
    const timeLabel = formatHHmm(finalHour, finalMinute);
    if (seen.has(timeLabel)) continue;
    seen.add(timeLabel);
    result.push(timeLabel);
    if (result.length >= 3) break;
  }

  return result;
};
