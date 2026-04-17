import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(@Req() req: Request, @Body() createStaffDto: CreateStaffDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (tenantId) {
      createStaffDto.tenantId = tenantId;
    }
    return this.staffService.create(createStaffDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(@Req() req: Request) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.staffService.findByTenant(tenantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.staffService.findOne(id).then((staff) => {
      if (!staff || staff.tenantId !== tenantId) {
        return null;
      }
      return staff;
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateStaffDto: UpdateStaffDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.staffService.findOne(id).then((staff) => {
      if (!staff || staff.tenantId !== tenantId) {
        throw new UnauthorizedException('Missing tenant id');
      }
      return this.staffService.update(id, updateStaffDto);
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.staffService.findOne(id).then((staff) => {
      if (!staff || staff.tenantId !== tenantId) {
        throw new UnauthorizedException('Missing tenant id');
      }
      return this.staffService.remove(id);
    });
  }
}
