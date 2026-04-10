import type { AssistantParsedResponse } from '../../utils/assistant-response-parser';
import type { ServicesService } from '../../../services/services.service';
import type { StaffService } from '../../../staff/staff.service';

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
  const services = await servicesService.findByTenant(tenantId);
  const normalized = names.map((name) => name.trim().toLowerCase());
  return services
    .filter((service) => normalized.includes(service.name.trim().toLowerCase()))
    .map((service) => service.id);
};

export const mapStaff = async (
  name: string | null,
  tenantId: string,
  staffService: StaffService,
): Promise<string | undefined> => {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return undefined;
  const noPreference = ['sin preferencia'];
  if (noPreference.includes(normalized)) return undefined;
  const staffList = await staffService.findByTenant(tenantId);
  const found = staffList.find(
    (staff) => staff.name.trim().toLowerCase() === normalized,
  );
  return found?.id;
};
