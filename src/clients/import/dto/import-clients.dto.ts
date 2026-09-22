import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/**
 * Convierte en arreglo lo que llegó como valor suelto.
 *
 * Un `multipart/form-data` no tiene tipos: un campo repetido llega como arreglo
 * y el mismo campo enviado una sola vez llega como texto. Sin esto, mapear el
 * nombre a una única columna fallaría la validación mientras que mapearlo a dos
 * pasaría, que es la clase de diferencia que nadie encuentra leyendo el DTO.
 */
const asArray = ({ value }: { value: unknown }): unknown =>
  value === undefined || Array.isArray(value) ? value : [value];

/**
 * Una casilla de un formulario multipart llega como `'true'` o `'false'`, no
 * como booleano. Se conserva el `undefined` para poder distinguir "no vino" de
 * "vino apagada": quien llama decide el valor por defecto.
 */
const asBoolean = ({ value }: { value: unknown }): unknown =>
  value === undefined ? undefined : value === true || value === 'true';

/**
 * Lo que acompaña al archivo: qué columna es cada cosa y cómo tratar lo que ya
 * existe.
 *
 * Todo es opcional porque el primer paso sube el archivo a secas: el mapeo se
 * detecta del encabezado y sólo viaja de vuelta cuando el negocio lo corrige.
 */
export class ImportClientsDto {
  /**
   * Las columnas que forman el nombre, **en orden**. Se concatenan: el modelo
   * tiene un solo `name` y Google reparte el nombre en tres columnas.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @IsString({ each: true })
  nameColumns?: string[];

  /** En orden de preferencia: se usa la primera que traiga algo en cada fila. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @IsString({ each: true })
  phoneColumns?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(asArray)
  @IsArray()
  @IsString({ each: true })
  emailColumns?: string[];

  /**
   * Prefijo del país para los números que no traen uno, sin `+`.
   *
   * Por defecto es el del negocio, deducido de su zona horaria. Se puede cambiar
   * porque una agenda vieja puede ser de otro país: el mismo `70123456` es de
   * una persona distinta según el prefijo que se le ponga adelante.
   */
  @ApiPropertyOptional({ example: '591' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,4}$/, {
    message: 'El prefijo del país son de 1 a 4 dígitos.',
  })
  dialCode?: string;

  /** Completar los campos vacíos de los clientes que ya existen. Nunca pisa. */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  fillMissing?: boolean;
}
