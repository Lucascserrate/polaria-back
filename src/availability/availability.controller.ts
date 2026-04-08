import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { FindAvailableSlotsDto } from './dto/find-available-slots.dto';

@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Post('slots')
  findAvailableSlots(@Body() input: FindAvailableSlotsDto) {
    return this.availabilityService.findAvailableSlots(input);
  }
}
