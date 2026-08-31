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
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { FindOrCreateClientDto } from './dto/find-or-create-client.dto';
import type { Request } from 'express';

@ApiTags('clients')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
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

  /**
   * El cliente de una reserva del panel: se reutiliza el que ya existe o se crea.
   *
   * Con teléfono pasa por el mismo resolver que WhatsApp y la página pública, y
   * por eso reconoce a quien ya reservó por cualquiera de los dos. Sin teléfono
   * no hay nada que reconocer y se crea uno nuevo cada vez; es el camino que
   * queda por cerrar del lado de la agenda.
   */
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

    const typedPhone = findOrCreateDto.phone?.trim();
    if (!typedPhone) {
      return this.clientsService.createUnidentified(
        tenantId,
        findOrCreateDto.name,
      );
    }

    return this.clientsService.resolveByPhone({
      tenantId,
      phone: { kind: 'typed', value: typedPhone },
      name: findOrCreateDto.name,
    });
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
