import { PartialType } from '@nestjs/swagger';
import { CreateBusinessHourDto } from './create-business_hour.dto';

export class UpdateBusinessHourDto extends PartialType(CreateBusinessHourDto) {}
