import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import type { Tenant } from '../tenants/entities/tenant.entity';
import { TenantsService } from '../tenants/tenants.service';
import {
  canExtendTrial,
  extendTrial,
  resolveSubscription,
  TRIAL_EXTENSION_DAYS,
} from '../subscriptions/subscription.rules';
import { ExtendTrialDto } from './dto/extend-trial.dto';

/**
 * Lo que soporte necesita saber y decidir sobre la prueba de un negocio.
 *
 * `state` viene resuelto y no crudo por la misma razón que en el resto del
 * producto: `TRIAL` guardado puede ser una prueba en curso o una vencida según
 * la hora, y hacer esa cuenta del lado del navegador sería una segunda copia de
 * `resolveSubscription` que se desactualiza sola.
 *
 * `canExtend` viaja por lo mismo: si el panel decidiera solo a quién ofrecerle
 * el botón, podría habilitarlo donde el backend después rechaza. Cómo se dice
 * ese "no" sí es del panel; **si** se puede, se decide en un solo lugar.
 */
export type TrialSummary = {
  /** Ver `SubscriptionState`. */
  state: string;
  /** Días completos que faltan. Sólo con la prueba en curso. */
  daysRemaining: number | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  canExtend: boolean;
  /**
   * Las extensiones que se ofrecen, ya proyectadas.
   *
   * Cada opción trae el vencimiento con el que quedaría, calculado con la misma
   * `extendTrial` que después la aplica. El panel necesita mostrarlo antes de
   * confirmar —es una acción que regala producto y conviene verla antes de
   * apretar—, y si esa cuenta la hiciera el navegador sería una copia de la
   * regla: "se suma al vencimiento vigente, salvo que ya haya vencido" es
   * exactamente el tipo de detalle que diverge sin que nadie se entere.
   *
   * Vacío cuando no se puede extender: no hay nada que ofrecer.
   */
  options: Array<{ days: number; trialEndsAt: string }>;
};

/**
 * La prueba gratuita de otro negocio, vista y extendida desde soporte.
 *
 * Vive en `support/` y no en `subscriptions/` por la misma razón que las rutas
 * de WhatsApp de soporte: son las que se van con el repositorio de
 * administración cuando se separe. La regla de cuánto se extiende y desde
 * cuándo se queda en el producto, que es donde también se decide el acceso.
 */
@ApiTags('support')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
@Controller('support/tenants/:tenantId/trial')
export class SupportTrialController {
  private readonly logger = new Logger(SupportTrialController.name);

  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOperation({ summary: 'Estado de la prueba gratuita de un negocio.' })
  async read(@Param('tenantId') tenantId: string): Promise<TrialSummary> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return summarize(tenant);
  }

  @Post('extend')
  @ApiOperation({
    summary:
      'Le suma días de prueba. Revive una vencida y arranca la del negocio que nunca la inició.',
  })
  async extend(
    @Param('tenantId') tenantId: string,
    @Body() body: ExtendTrialDto,
  ): Promise<TrialSummary> {
    this.logger.log(
      `Extensión de prueba pedida desde soporte (tenantId=${tenantId}, días=${body.days}).`,
    );

    return summarize(
      await this.tenantsService.extendTrial(tenantId, body.days),
    );
  }
}

/**
 * Un solo `now` para todo el resumen.
 *
 * El estado y las proyecciones se calculan contra el mismo instante: con dos
 * relojes, una prueba que vence en este segundo podría informarse en curso y
 * proyectarse como vencida en la misma respuesta.
 */
function summarize(tenant: Tenant, now: Date = new Date()): TrialSummary {
  const resolved = resolveSubscription(
    {
      subscriptionStatus: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt ?? null,
    },
    now,
  );

  const input = {
    subscriptionStatus: tenant.subscriptionStatus,
    trialStartedAt: tenant.trialStartedAt ?? null,
    trialEndsAt: tenant.trialEndsAt ?? null,
  };

  return {
    state: resolved.state,
    daysRemaining: resolved.trialDaysRemaining,
    trialStartedAt: tenant.trialStartedAt?.toISOString() ?? null,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    canExtend: canExtendTrial(tenant.subscriptionStatus),
    options: TRIAL_EXTENSION_DAYS.flatMap((days) => {
      const outcome = extendTrial(input, days, now);

      return outcome.granted
        ? [{ days, trialEndsAt: outcome.trialEndsAt.toISOString() }]
        : [];
    }),
  };
}
