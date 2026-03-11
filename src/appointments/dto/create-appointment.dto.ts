export class CreateAppointmentDto {
  tenantId: string;
  staffId: string;
  clientId: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
}
