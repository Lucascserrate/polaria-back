export class CreateServiceDto {
  tenantId: string;
  name: string;
  description?: string;
  price: number;
  timezone: string;
  durationMinutes: number;
  isActive?: boolean;
}
