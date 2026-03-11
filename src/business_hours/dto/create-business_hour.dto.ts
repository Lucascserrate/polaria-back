import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateBusinessHourDto {
  @ApiProperty()
  @IsUUID()
  tenantId: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty()
  @IsString()
  startTime: string;

  @ApiProperty()
  @IsString()
  endTime: string;
}
