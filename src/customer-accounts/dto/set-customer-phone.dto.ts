import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetCustomerPhoneDto {
  /**
   * El número tal como lo escribió la persona.
   *
   * No se valida la forma acá: eso lo hace `normalizeClientPhone`, que es la
   * única que sabe cómo se escribe un teléfono en Polaria. Lo de acá es solo el
   * tope de lo que se acepta leer.
   */
  @IsString()
  @MinLength(4)
  @MaxLength(32)
  phone!: string;

  /**
   * Zona horaria del negocio donde está reservando, para deducir el prefijo del
   * país cuando el número viene local.
   *
   * Viaja desde la página y no se guarda: la cuenta es global y no tiene país
   * propio. Si la zona no se reconoce, `dialCodeForTimeZone` cae a su valor por
   * defecto y el número escrito con `+` sigue mandando.
   */
  @IsString()
  @MaxLength(64)
  timezone!: string;
}
