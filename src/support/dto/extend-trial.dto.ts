import { IsIn, IsInt } from 'class-validator';

import { TRIAL_EXTENSION_DAYS } from '../../subscriptions/subscription.rules';

/**
 * Cuánta prueba se regala, en días.
 *
 * Restringido a la lista y no a "un entero positivo": esta ruta reparte
 * producto gratis, y un campo abierto convierte un dedo pesado en tres años de
 * Polaria sin cobrar. Los tamaños posibles son una decisión comercial y viven
 * en `TRIAL_EXTENSION_DAYS`, que es también lo que el panel ofrece.
 */
export class ExtendTrialDto {
  @IsInt()
  @IsIn([...TRIAL_EXTENSION_DAYS])
  days!: number;
}
