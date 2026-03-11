export class CreateStaffDto {
  tenantId: string;
  name: string;
  email: string;
  calendarId?: string;
  isActive?: boolean;
}
