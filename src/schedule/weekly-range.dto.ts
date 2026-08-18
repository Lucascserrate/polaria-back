import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { TIME_PATTERN } from './weekly-schedule.util';

/**
 * Una franja de una jornada semanal, tanto la del negocio como la de un
 * profesional. Las reglas que cruzan varias franjas (solapamientos, jornada
 * vacía) viven en `assertValidWeeklySchedule` y en cada llamador.
 */
export class WeeklyRangeDto {
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
