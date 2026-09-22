import { IsIn, IsInt } from 'class-validator';

import { SUBSCRIPTION_MONTHS } from '../../subscriptions/subscription.rules';

/**
 * Cuánto se cobró, en meses.
 *
 * Restringido a la lista y no a "un entero positivo" por lo mismo que
 * `ExtendTrialDto`: esta ruta mueve la fecha hasta la que un negocio tiene
 * Polaria, y un campo abierto convierte un dedo pesado en veinte años sin
 * cobrar. Los plazos vendibles son una decisión comercial y viven en
 * `SUBSCRIPTION_MONTHS`, que es también lo que el panel ofrece.
 */
export class PaySubscriptionDto {
  @IsInt()
  @IsIn([...SUBSCRIPTION_MONTHS])
  months!: number;
}
