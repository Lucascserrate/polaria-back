import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { TIME_PATTERN } from '../utils/staff-schedule.util';

/**
 * Una franja de la jornada semanal. Las reglas que cruzan varias franjas
 * (solapamientos, jornada vacía) viven en `assertValidStaffSchedules`.
 */
export class StaffScheduleDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = domingo' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  @Matches(TIME_PATTERN, { message: 'startTime debe tener formato HH:MM' })
  startTime!: string;

  @ApiProperty({ example: '17:00' })
  @Matches(TIME_PATTERN, { message: 'endTime debe tener formato HH:MM' })
  endTime!: string;
}
