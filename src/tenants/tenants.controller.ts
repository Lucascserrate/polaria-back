import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { resolveSubscription } from '../subscriptions/subscription.rules';

import type { Tenant } from './entities/tenant.entity';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

/**
 * El estado de la suscripción que viaja con cada negocio del listado.
 *
 * Es un eje distinto de `status`, y por eso va aparte y no como un tercer valor
 * suyo: `status` dice si soporte tiene la cuenta habilitada —y es lo que filtra
 * el directorio público—, mientras que esto dice si el negocio está probando
 * Polaria o ya paga. Un negocio en prueba es una cuenta activa; meterlo en
 * `status` lo sacaría del buscador público por estar en su semana de prueba.
 */
export type TenantSubscription = {
  state: string;
  daysRemaining: number | null;
  trialEndsAt: string | null;
};

export type TenantListItem = Tenant & { subscription: TenantSubscription };

function describeSubscriptions(
  tenants: Tenant[],
  now: Date = new Date(),
): TenantListItem[] {
  return tenants.map((tenant) => {
    const resolved = resolveSubscription(
      {
        subscriptionStatus: tenant.subscriptionStatus,
        trialEndsAt: tenant.trialEndsAt ?? null,
      },
      now,
    );

    return {
      ...tenant,
      subscription: {
        state: resolved.state,
        daysRemaining: resolved.trialDaysRemaining,
        trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      },
    };
  });
}

/**
 * Herramienta interna de soporte: alta, listado y edición de negocios.
 *
 * Todo el controlador queda detrás del permiso de soporte. Hasta ahora era
 * **público** —cualquiera con la URL podía crear tenants o listarlos todos—, y
 * con el registro abierto eso deja de ser un descuido tolerable: bastaría con
 * registrarse para ver la cartera de clientes entera.
 *
 * Un negocio no necesita nada de acá para operar: se edita a sí mismo por
 * `/settings`.
 */
@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @Get()
  async findAll(): Promise<TenantListItem[]> {
    return describeSubscriptions(await this.tenantsService.findAll());
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantsService.update(id, updateTenantDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }
}
