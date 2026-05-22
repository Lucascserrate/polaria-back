export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function getStringField(obj: JsonObject, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

export function getObjectField(
  obj: JsonObject,
  key: string,
): JsonObject | null {
  return asObject(obj[key]);
}

export function getArrayField(obj: JsonObject, key: string): unknown[] | null {
  return asArray(obj[key]);
}

export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}
