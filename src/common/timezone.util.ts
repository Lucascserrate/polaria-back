export function normalizeTimezone(timezone?: string): string {
  const fallback = 'America/La_Paz';
  if (!timezone || timezone.trim().length === 0) {
    return fallback;
  }

  try {
    new Intl.DateTimeFormat('es-CO', { timeZone: timezone }).format(
      new Date(),
    );
    return timezone;
  } catch {
    return fallback;
  }
}
