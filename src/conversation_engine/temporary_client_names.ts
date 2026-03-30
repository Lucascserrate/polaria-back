const TEMPORARY_CLIENT_NAMES = [
  'Juan',
  'Maria',
  'Luis',
  'Ana',
  'Emily',
  'Sofia',
  'Pedro',
  'Laura',
  'Jorge',
  'Camila',
  'Diego',
  'Valentina mi ex',
  'Andres',
  'Paola',
  'Mateo',
  'Daniela',
  null,
];

export function getTemporaryClientName(seed?: string | null): string | null {
  if (!seed) {
    return null;
  }
  const index = hashString(seed) % TEMPORARY_CLIENT_NAMES.length;
  return TEMPORARY_CLIENT_NAMES[index] ?? null;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
