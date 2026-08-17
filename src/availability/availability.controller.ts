import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AvailabilityService } from './availability.service';
import { FindAvailableSlotsDto } from './dto/find-available-slots.dto';
import { WorkingStaffQueryDto } from './dto/working-staff-query.dto';

@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Post('slots')
  findAvailableSlots(@Body() input: FindAvailableSlotsDto) {
    return this.availabilityService.findAvailableSlots(input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('working-staff')
  getWorkingStaff(@Req() req: Request, @Query() query: WorkingStaffQueryDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.availabilityService.getWorkingStaff(tenantId, query.date);
  }
}
