import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { GrantAccessDto } from './dto/grant-access.dto';
import { Actor, type AuthenticatedActor } from '../auth/actor';
import { AdminOnly, Roles, RolesGuard } from '../auth/guards/roles.guard';
import { STAFF_ACCESS_ROLES } from './staff-role';
import { Staff } from './entities/staff.entity';

/**
 * El equipo del negocio.
 *
 * La ruta sigue siendo `/staff` aunque el producto ahora diga "Equipo": lo que
 * cambió es el lenguaje de la pantalla, no el modelo, y renombrar la API habría
 * sido superficie de cambio sin nada a cambio.
 *
 * Todo acá es de administración —el `@AdminOnly` está a nivel de clase— con una
 * excepción declarada abajo: `/staff/me`, que es cómo un profesional lee su propia
 * ficha.
 */
@ApiTags('staff')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  create(
    @Actor() actor: AuthenticatedActor,
    @Body() createStaffDto: CreateStaffDto,
  ) {
    createStaffDto.tenantId = actor.tenantId;
    return this.staffService.create(createStaffDto);
  }

  @Get()
  findAll(@Actor() actor: AuthenticatedActor) {
    return this.staffService.findByTenant(actor.tenantId);
  }

  /**
   * La propia ficha del miembro del equipo que está mirando.
   *
   * Rompe el `@AdminOnly` de la clase a propósito, y es la única que lo hace: acá
   * no hay nada que un profesional no deba ver, porque lo que devuelve es él mismo.
   * El id sale del token —nunca de la URL— así que no hay forma de pedir la ficha
   * de otro.
   *
   * Va antes de `:id` para que `me` no se lea como un identificador.
   */
  @Get('me')
  @Roles(...STAFF_ACCESS_ROLES)
  async findMe(@Actor() actor: AuthenticatedActor) {
    if (!actor.staffId) {
      // El dueño no es una fila de `staff`. Ver `AuthenticatedActor`.
      throw new NotFoundException(
        'La cuenta del negocio no es una ficha del equipo',
      );
    }

    return this.requireInTenant(actor, actor.staffId);
  }

  @Get(':id')
  findOne(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.requireInTenant(actor, id);
  }

  @Patch(':id')
  async update(
    @Actor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body() updateStaffDto: UpdateStaffDto,
  ) {
    await this.requireInTenant(actor, id);
    return this.staffService.update(id, updateStaffDto);
  }

  @Delete(':id')
  async remove(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    await this.requireInTenant(actor, id);
    return this.staffService.remove(id);
  }

  /** Habilita el acceso a Polaria con un correo. */
  @Post(':id/access')
  async grantAccess(
    @Actor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body() body: GrantAccessDto,
  ) {
    await this.requireInTenant(actor, id);
    return this.staffService.grantAccess(id, body.email);
  }

  @Delete(':id/access')
  async revokeAccess(
    @Actor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ) {
    await this.requireInTenant(actor, id);
    return this.staffService.revokeAccess(id);
  }

  /**
   * La ficha, verificando que sea de este negocio.
   *
   * Responde 404 y no 403 cuando el id existe pero es de otro tenant: decir "existe
   * pero no es tuyo" confirmaría la existencia de un id ajeno, que es información
   * que no le toca a nadie. Antes esto devolvía 401, que además de filtrar lo mismo
   * hacía que el cliente cerrara la sesión por un id equivocado.
   */
  private async requireInTenant(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<Staff> {
    const staff = await this.staffService.findOne(id);

    if (!staff || staff.tenantId !== actor.tenantId) {
      throw new NotFoundException('Miembro del equipo no encontrado');
    }

    return staff;
  }
}
