import type { AssistantParsedResponse } from '../../utils/assistant-response-parser';
import type { ServicesService } from '../../../services/services.service';
import type { StaffService } from '../../../staff/staff.service';

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const tokenize = (value: string): string[] => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
};

const jaccard = (a: string[], b: string[]): number => {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export const hasAvailabilityEntities = (
  entities: AssistantParsedResponse['entities'] | undefined,
): entities is {
  services: string[];
  staff?: string | null;
  date: string;
  time: string;
} => {
  if (!entities) return false;
  if (!Array.isArray(entities.services) || entities.services.length === 0) {
    return false;
  }
  if (typeof entities.date !== 'string' || entities.date.trim() === '') {
    return false;
  }
  if (typeof entities.time !== 'string' || entities.time.trim() === '') {
    return false;
  }
  return true;
};

export const buildAvailabilityKey = (
  serviceIds: string[],
  staffId: string | undefined,
  date: string,
  time: string,
): string => {
  const sortedServices = [...serviceIds].sort().join('|');
  return [sortedServices, staffId ?? '', date, time].join('::');
};

export const mapServices = async (
  names: string[],
  tenantId: string,
  servicesService: ServicesService,
): Promise<string[]> => {
  if (!names.length) return [];
  const services = await servicesService.findActiveByTenant(tenantId);
  const normalizedNames = names.map(normalizeText).filter(Boolean);

  if (services.length === 1) return [services[0].id];

  const exactMatches = services
    .filter((service) =>
      normalizedNames.includes(normalizeText(service.name ?? '')),
    )
    .map((service) => service.id);
  if (exactMatches.length > 0) return exactMatches;

  const fuzzyMatches = services
    .filter((service) => {
      const serviceName = normalizeText(service.name ?? '');
      if (!serviceName) return false;
      return normalizedNames.some(
        (n) => serviceName.includes(n) || n.includes(serviceName),
      );
    })
    .map((service) => service.id);

  if (fuzzyMatches.length > 0) return fuzzyMatches;

  const byId = new Map<string, string>();
  for (const service of services) {
    const nameText = service.name ?? '';
    if (!nameText) continue;
    byId.set(service.id, nameText);
  }

  const picked = new Set<string>();
  for (const requested of names) {
    const requestedTokens = tokenize(requested);
    let best: { id: string; score: number } | undefined;

    for (const [id, serviceName] of byId.entries()) {
      const score = jaccard(requestedTokens, tokenize(serviceName));
      if (!best || score > best.score) best = { id, score };
    }

    if (best && best.score >= 0.34) {
      picked.add(best.id);
    }
  }

  const result = [...picked];

  if (result.length === 0 && services.length > 0) {
    const requestedCombined = tokenize(names.join(' '));
    let best: { id: string; score: number } | undefined;
    let secondBestScore = 0;

    for (const service of services) {
      const score = jaccard(requestedCombined, tokenize(service.name ?? ''));
      if (!best || score > best.score) {
        secondBestScore = best?.score ?? secondBestScore;
        best = { id: service.id, score };
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    const gap = best ? best.score - secondBestScore : 0;
    if (best && (best.score >= 0.2 || gap >= 0.15)) {
      return [best.id];
    }
  }

  return result;
};

export const mapStaff = async (
  name: string | null,
  tenantId: string,
  staffService: StaffService,
): Promise<string | undefined> => {
  const normalized = name ? normalizeText(name) : undefined;
  if (!normalized) return undefined;
  const noPreference = ['sin preferencia'];
  if (noPreference.includes(normalized)) return undefined;
  const staffList = await staffService.findByTenant(tenantId);
  const found = staffList.find(
    (staff) => normalizeText(staff.name ?? '') === normalized,
  );
  return found?.id;
};
