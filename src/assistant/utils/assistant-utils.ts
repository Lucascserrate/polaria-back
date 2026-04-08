export function buildTempName(phone: string): string {
  const suffix = phone.slice(-4);
  return `Usuario ${suffix || 'nuevo'}`;
}
