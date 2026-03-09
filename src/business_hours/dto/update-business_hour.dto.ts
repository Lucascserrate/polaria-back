import { PartialType } from '@nestjs/mapped-types';
import { CreateBusinessHourDto } from './create-business_hour.dto';

export class UpdateBusinessHourDto extends PartialType(CreateBusinessHourDto) {}
