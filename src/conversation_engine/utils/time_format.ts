export function formatTime(date: Date, timezone?: string) {
  return date.toLocaleTimeString('es-BO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
}

export function formatDateTime(date: Date, timezone?: string) {
  return date.toLocaleString('es-BO', {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
}
