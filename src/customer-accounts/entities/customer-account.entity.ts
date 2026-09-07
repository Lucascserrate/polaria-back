import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * La cuenta de quien reserva. Es de Polaria, no de un negocio.
 *
 * Es la otra mitad del modelo de clientes y conviene tener clara la diferencia,
 * porque las dos existen a la vez y ninguna reemplaza a la otra:
 *
 * - `Client` es la ficha que un negocio tiene de una persona. Su identidad es el
 *   teléfono, y así seguirá: la mayoría de los clientes de un negocio existen
 *   solo como número —llegaron por WhatsApp o los cargó el dueño a mano— y nunca
 *   van a tener cuenta.
 * - `CustomerAccount` es la persona en Polaria. Su identidad es la cuenta de
 *   Google. Sirve para no volver a pedirle sus datos en ningún negocio del
 *   marketplace, y más adelante para que vea sus reservas y deje reseñas.
 *
 * El puente entre las dos es el teléfono, y es un puente de un solo sentido a
 * propósito: la cuenta dice con qué número reservar, pero **no** da acceso a lo
 * que ese número hizo antes. Un teléfono es un identificador, no una credencial
 * —cualquiera puede escribir el de otro—, así que lo que la cuenta puede leer es
 * lo que hizo la cuenta. Ver `appointments.customerAccountId`.
 */
@Index(['googleId'], { unique: true })
@Entity('customer_accounts')
export class CustomerAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * El `sub` que devuelve Google. Es la identidad estable de la cuenta.
   *
   * Único: dos filas con el mismo `googleId` serían la misma persona con dos
   * cuentas, y el login no tendría forma de elegir a cuál entrar.
   */
  @Column({ type: 'varchar', length: 255 })
  googleId!: string;

  /**
   * Correo de Google. Indexado pero **no** único.
   *
   * No es único porque no es la identidad: Google permite cambiar el correo de
   * una cuenta, y un choque de correos entre dos cuentas dejaría a alguien sin
   * poder entrar. Se guarda porque es la única forma de contacto que tenemos
   * fuera de WhatsApp y porque es lo que el negocio va a reconocer.
   */
  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  /** Nombre tal como lo da Google. Es lo que se usa al reservar. */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /**
   * Teléfono en formato `wa_id` —dígitos con código de país y sin `+`—, o `NULL`
   * si todavía no lo dio.
   *
   * El mismo formato que `clients.phone`, y no por prolijidad: se normaliza con
   * `normalizeClientPhone`, que es la única función que decide cómo se escribe un
   * teléfono en Polaria. Si esta columna guardara otro formato, la persona que
   * reserva por el link y la que escribe por WhatsApp serían dos clientes
   * distintos para el negocio, con el historial partido en dos.
   *
   * `NULL` es un estado real y esperado: Google no da el teléfono, así que una
   * cuenta recién creada no lo tiene y hay que pedirlo una vez antes de poder
   * reservar.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
