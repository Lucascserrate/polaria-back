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
  paySubscription,
  resolveSubscription,
  SUBSCRIPTION_MONTHS,
  TRIAL_EXTENSION_DAYS,
} from '../subscriptions/subscription.rules';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { PaySubscriptionDto } from './dto/pay-subscription.dto';

/**
 * Lo que soporte necesita saber y decidir sobre lo que un negocio paga.
 *
 * Un solo resumen para la prueba y para la suscripción, y no uno por cada una:
 * son dos tramos del mismo recorrido —se prueba, se paga, se renueva— y el
 * negocio está en uno solo por vez. Dos respuestas obligarían a quien las lee a
 * decidir cuál manda, que es justo la cuenta que `resolveSubscription` existe
 * para hacer en un solo lugar.
 *
 * `state` viene resuelto y no crudo por la misma razón que en el resto del
 * producto: `TRIAL` o `ACTIVE` guardados pueden ser algo en curso o algo vencido
 * según la hora, y hacer esa cuenta del lado del navegador sería una segunda
 * copia de la regla que decide el acceso.
 *
 * `canExtendTrial` viaja por lo mismo: si el panel decidiera solo a quién
 * ofrecerle el botón, podría habilitarlo donde el backend después rechaza. Cómo
 * se dice ese "no" sí es del panel; **si** se puede, se decide en un solo lugar.
 */
export type SubscriptionSummary = {
  /** Ver `SubscriptionState`. */
  state: string;
  /** Días completos que faltan: de la prueba en curso o de lo que está pago. */
  daysRemaining: number | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** Hasta cuándo está paga la suscripción. `null` si nunca pagó. */
  subscriptionEndsAt: string | null;
  canExtendTrial: boolean;
  /**
   * Las extensiones de prueba que se ofrecen, ya proyectadas.
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
  trialOptions: Array<{ days: number; trialEndsAt: string }>;
  /**
   * Los plazos que se pueden cobrar, con la fecha hasta la que cubriría cada
   * uno. Proyectados por el backend por lo mismo que los de la prueba: la regla
   * de que los meses se suman al vencimiento vigente —y de qué pasa el 31 de
   * enero— no puede tener una segunda implementación en el navegador.
   */
  paymentOptions: Array<{ months: number; subscriptionEndsAt: string }>;
};

/**
 * La prueba y la suscripción de un negocio, vistas y movidas desde soporte.
 *
 * Vive en `support/` y no en `subscriptions/` por la misma razón que las rutas
 * de WhatsApp de soporte: son las que se van con el repositorio de
 * administración cuando se separe. Las reglas —cuánto se extiende, desde cuándo
 * corre lo pagado— se quedan en el producto, que es donde también se decide el
 * acceso.
 */
@ApiTags('support')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
@Controller('support/tenants/:tenantId/subscription')
export class SupportSubscriptionController {
  private readonly logger = new Logger(SupportSubscriptionController.name);

  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOperation({ summary: 'Estado comercial de un negocio: prueba y pagos.' })
  async read(
    @Param('tenantId') tenantId: string,
  ): Promise<SubscriptionSummary> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return summarize(tenant);
  }

  @Post('extend-trial')
  @ApiOperation({
    summary:
      'Le suma días de prueba. Revive una vencida y arranca la del negocio que nunca la inició.',
  })
  async extend(
    @Param('tenantId') tenantId: string,
    @Body() body: ExtendTrialDto,
  ): Promise<SubscriptionSummary> {
    this.logger.log(
      `Extensión de prueba pedida desde soporte (tenantId=${tenantId}, días=${body.days}).`,
    );

    return summarize(
      await this.tenantsService.extendTrial(tenantId, body.days),
    );
  }

  @Post('pay')
  @ApiOperation({
    summary:
      'Registra que el negocio pagó. Da de alta la suscripción y también la renueva.',
  })
  async pay(
    @Param('tenantId') tenantId: string,
    @Body() body: PaySubscriptionDto,
  ): Promise<SubscriptionSummary> {
    this.logger.log(
      `Pago registrado desde soporte (tenantId=${tenantId}, meses=${body.months}).`,
    );

    return summarize(
      await this.tenantsService.paySubscription(tenantId, body.months),
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
function summarize(
  tenant: Tenant,
  now: Date = new Date(),
): SubscriptionSummary {
  const resolved = resolveSubscription(
    {
      subscriptionStatus: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt ?? null,
      subscriptionEndsAt: tenant.subscriptionEndsAt ?? null,
    },
    now,
  );

  const trialInput = {
    subscriptionStatus: tenant.subscriptionStatus,
    trialStartedAt: tenant.trialStartedAt ?? null,
    trialEndsAt: tenant.trialEndsAt ?? null,
  };

  const paymentInput = {
    subscriptionStatus: tenant.subscriptionStatus,
    subscriptionEndsAt: tenant.subscriptionEndsAt ?? null,
  };

  return {
    state: resolved.state,
    daysRemaining: resolved.daysRemaining,
    trialStartedAt: tenant.trialStartedAt?.toISOString() ?? null,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    subscriptionEndsAt: tenant.subscriptionEndsAt?.toISOString() ?? null,
    canExtendTrial: canExtendTrial(tenant.subscriptionStatus),
    trialOptions: TRIAL_EXTENSION_DAYS.flatMap((days) => {
      const outcome = extendTrial(trialInput, days, now);

      return outcome.granted
        ? [{ days, trialEndsAt: outcome.trialEndsAt.toISOString() }]
        : [];
    }),
    paymentOptions: SUBSCRIPTION_MONTHS.flatMap((months) => {
      const outcome = paySubscription(paymentInput, months, now);

      return outcome.granted
        ? [
            {
              months,
              subscriptionEndsAt: outcome.subscriptionEndsAt.toISOString(),
            },
          ]
        : [];
    }),
  };
}
