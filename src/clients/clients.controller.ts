import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import { Actor, type AuthenticatedActor } from '../auth/actor';
import { AppointmentsService } from '../appointments/appointments.service';
import { ClientsService } from './clients.service';
import { ClientSource } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';

/**
 * La ficha de clientes del negocio.
 *
 * El `tenantId` sale siempre del token y nunca del cuerpo ni de la query: es lo
 * único que separa a los clientes de un negocio de los de otro, y un negocio que
 * pudiera elegirlo podría leer y borrar la cartera del vecino.
 */
@ApiTags('clients')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  @Post()
  create(
    @Actor() actor: AuthenticatedActor,
    @Body() createClientDto: CreateClientDto,
  ) {
    /*
     * El alta a mano también pasa por el resolver. Si el número ya es de un
     * cliente del negocio, se devuelve ése en vez de fallar: para quien lo está
     * cargando, "ya existe" y "acá está" son la misma respuesta útil.
     */
    return this.clientsService.resolveByPhone({
      tenantId: actor.tenantId,
      phone: { kind: 'typed', value: createClientDto.phone },
      name: createClientDto.name,
      source: ClientSource.PANEL,
      profile: {
        email: createClientDto.email,
        birthDate: createClientDto.birthDate,
        notes: createClientDto.notes,
      },
    });
  }

  @Get()
  findAll(
    @Actor() actor: AuthenticatedActor,
    @Query() query: ListClientsQueryDto,
  ) {
    return this.clientsService.findPageByTenant(actor.tenantId, query);
  }

  @Get(':id')
  findOne(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.clientsService.findOneByTenant(id, actor.tenantId);
  }

  @Get(':id/summary')
  summary(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.clientsService.getSummary(id, actor.tenantId);
  }

  /**
   * El historial de citas del cliente.
   *
   * Cuelga de `/clients` porque es como se lee —"las citas de esta persona"— pero
   * lo resuelve `AppointmentsService`, que ya tiene los joins y el mapeo. Duplicar
   * esa consulta acá haría que la ficha y la agenda muestren cosas distintas en
   * cuanto una de las dos agregue un dato.
   */
  @Get(':id/appointments')
  async appointments(
    @Actor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Query() query: ListClientsQueryDto,
  ) {
    // Comprueba que el cliente sea de este negocio antes de listar nada.
    await this.clientsService.findOneByTenant(id, actor.tenantId);

    return this.appointmentsService.findPageByClient(
      actor.tenantId,
      id,
      query.page,
      query.limit,
    );
  }

  @Patch(':id')
  update(
    @Actor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    return this.clientsService.updateByTenant(
      id,
      actor.tenantId,
      updateClientDto,
    );
  }

  @Delete(':id')
  remove(@Actor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.clientsService.removeByTenant(id, actor.tenantId);
  }
}
