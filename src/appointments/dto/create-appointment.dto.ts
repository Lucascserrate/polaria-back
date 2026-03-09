export class CreateAppointmentDto {
  tenantId: number;
  staffId: number;
  clientId: number;
  serviceId: number;
  startTime: Date;
  endTime: Date;
}
