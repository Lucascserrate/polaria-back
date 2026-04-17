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
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { FindOrCreateClientDto } from './dto/find-or-create-client.dto';
import type { Request } from 'express';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(@Req() req: Request, @Body() createClientDto: CreateClientDto) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    createClientDto.tenantId = tenantId;
    return this.clientsService.create(createClientDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('find-or-create')
  findOrCreate(
    @Req() req: Request,
    @Body() findOrCreateDto: FindOrCreateClientDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.clientsService.findOrCreateByPhone(
      tenantId,
      findOrCreateDto.name,
      findOrCreateDto.phone,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(@Req() req: Request) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.clientsService.findByTenant(tenantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.clientsService.findOne(id).then((client) => {
      if (!client || client.tenantId !== tenantId) {
        return null;
      }
      return client;
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.clientsService.findOne(id).then((client) => {
      if (!client || client.tenantId !== tenantId) {
        throw new UnauthorizedException('Missing tenant id');
      }
      return this.clientsService.update(id, updateClientDto);
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.clientsService.findOne(id).then((client) => {
      if (!client || client.tenantId !== tenantId) {
        throw new UnauthorizedException('Missing tenant id');
      }
      return this.clientsService.remove(id);
    });
  }
}
