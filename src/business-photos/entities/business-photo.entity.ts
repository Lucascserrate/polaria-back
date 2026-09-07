import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * Una foto del local, de las que se ven en la página pública del negocio.
 *
 * Tabla propia y no una columna JSON en `tenants`: son varias, tienen orden, se
 * borran de a una y cada una arrastra un archivo en Cloudinary que hay que
 * poder borrar con ella. Un JSON obligaría a reescribir el arreglo completo
 * para quitar una sola foto —dos pestañas abiertas y una pisa a la otra— y a
 * recorrerlo en memoria para encontrar la que se está borrando.
 *
 * Distinto de `tenants.logoUrl`, que es una sola imagen con identificador
 * determinista. Acá el identificador lo inventa Cloudinary —tiene que ser
 * distinto en cada foto— así que se guarda: sin él no habría con qué borrar el
 * archivo, y quedaría ocupando la cuota para siempre.
 */
@Index(['tenantId', 'position'])
@Entity('business_photos')
export class BusinessPhoto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  /**
   * `CASCADE`: las fotos de un negocio que se da de baja no tienen sentido
   * propio. Los archivos en Cloudinary **no** se van con esto —la base no sabe
   * borrar en un servicio externo—; para eso está `deleteFolder`, que borra la
   * carpeta entera del negocio.
   */
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  /** URL de entrega, con versión. Ver `tenants.logoUrl` para el porqué. */
  @Column({ type: 'varchar', length: 512 })
  url!: string;

  /** Identificador en Cloudinary. Es lo único con lo que se puede borrar. */
  @Column({ type: 'varchar', length: 255 })
  publicId!: string;

  /**
   * Medidas del archivo guardado.
   *
   * Viajan hasta el navegador para que la galería reserve el espacio exacto
   * antes de que la imagen cargue. Sin esto, la página salta cuando entra cada
   * foto, que es justo lo que se ve peor con datos móviles.
   */
  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;

  /**
   * Orden de la galería, arrancando en 0. La `0` es la portada.
   *
   * Las posiciones se recalculan enteras en cada cambio y quedan siempre
   * contiguas: es lo que permite leer "la portada es la 0" sin consultar el
   * resto. Ver `BusinessPhotosService.reindex`.
   */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
