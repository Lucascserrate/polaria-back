import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Tenant } from '../tenants/entities/tenant.entity';
import { WhatsAppTemplate } from './entities/whatsapp-template.entity';
import { TemplateKey } from './template-registry';
import { TemplateStatus } from './template-status';

/**
 * Estado de las plantillas de cada negocio. No decide nada.
 *
 * Reemplaza a las cuatro columnas de `tenants` que guardaban la única plantilla que
 * había. Ver `whatsapp-template.entity` para por qué se mudó.
 */
@Injectable()
export class WhatsAppTemplatesRepository {
  constructor(
    @InjectRepository(WhatsAppTemplate)
    private readonly repository: Repository<WhatsAppTemplate>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
  ) {}

  find(tenantId: string, templateKey: TemplateKey) {
    return this.repository.findOne({ where: { tenantId, templateKey } });
  }

  findAllByTenant(tenantId: string) {
    return this.repository.find({ where: { tenantId } });
  }

  /**
   * Guarda el estado de una plantilla.
   *
   * `upsert` sobre la clave única: dos aprovisionamientos simultáneos —el negocio
   * reconecta mientras el job relee— actualizan en lugar de estallar con un error
   * de duplicado.
   */
  async save(params: {
    tenantId: string;
    templateKey: TemplateKey;
    name: string;
    language: string;
    status: TemplateStatus;
    metaStatus: string | null;
  }): Promise<void> {
    await this.repository.upsert(params, {
      conflictPaths: ['tenantId', 'templateKey'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  /**
   * Plantillas que siguen esperando revisión de Meta.
   *
   * Es lo que consulta el job de aprobaciones. Trae el tenant porque para
   * preguntarle a Meta hacen falta sus credenciales.
   */
  findPending(): Promise<WhatsAppTemplate[]> {
    return this.repository.find({
      where: { status: In([TemplateStatus.PENDING]) },
      relations: { tenant: true },
    });
  }

  /**
   * Borra las plantillas de un negocio.
   *
   * Se llama al desconectar WhatsApp: una plantilla pertenece a una WABA, y la de
   * la conexión anterior no se puede enviar desde la nueva. Es el mismo criterio con
   * el que se limpian las credenciales.
   */
  async deleteByTenant(tenantId: string): Promise<void> {
    await this.repository.delete({ tenantId });
  }

  /**
   * Negocios ya conectados a los que les falta una plantilla.
   *
   * Es lo que permite que un negocio que conectó WhatsApp **antes** de que esta
   * plantilla existiera la reciba sin desconectar y reconectar. Y no es solo para
   * este caso: el día que se agregue una quinta plantilla, los negocios existentes
   * la van a recibir por este mismo camino, sin otro backfill.
   *
   * Dos situaciones cuentan como "le falta", y una tercera a propósito no:
   *
   * - **No hay fila.** El caso normal: conectó antes de que la plantilla existiera.
   * - **La fila está en `NOT_CREATED` y ya pasó el tiempo de espera.** Significa que
   *   el intento anterior falló —token sin permisos, WABA equivocada— y se reintenta
   *   con la espera de `PROVISION_RETRY_HOURS`, no en cada pasada.
   * - **La fila está en `UNAVAILABLE` y no se toca.** Ese es el rechazo de Meta, y no
   *   se arregla reintentando: hace falta cambiar el texto, que significa otra
   *   plantilla con otro nombre. Reintentarla sería pedirle a Meta lo mismo que ya
   *   rechazó, para siempre.
   *
   * La condición de conexión filtra la cadena vacía además del `NULL` porque estas
   * columnas pueden tener guardado `''`, `'null'` o `'undefined'` —ver
   * `readStoredCredential`—; el llamador vuelve a validar con esa función, que es la
   * que sabe reconocerlos todos.
   */
  findConnectedMissing(params: {
    templateKey: TemplateKey;
    retryBefore: Date;
    take: number;
  }): Promise<Tenant[]> {
    return this.tenants
      .createQueryBuilder('tenant')
      .leftJoin(
        WhatsAppTemplate,
        'template',
        'template.tenantId = tenant.id AND template.templateKey = :templateKey',
        { templateKey: params.templateKey },
      )
      .where('tenant.whatsappAccessToken IS NOT NULL')
      .andWhere("tenant.whatsappAccessToken <> ''")
      .andWhere('tenant.whatsappWabaId IS NOT NULL')
      .andWhere("tenant.whatsappWabaId <> ''")
      .andWhere(
        '(template.id IS NULL OR (template.status = :notCreated AND template.updatedAt <= :retryBefore))',
        {
          notCreated: TemplateStatus.NOT_CREATED,
          retryBefore: params.retryBefore,
        },
      )
      .orderBy('tenant.createdAt', 'ASC')
      .limit(params.take)
      .getMany();
  }
}

/**
 * Cuánto se espera antes de reintentar un aprovisionamiento que falló.
 *
 * Un fallo acá casi siempre es un problema de configuración —token sin
 * `whatsapp_business_management`, WABA equivocada— y eso lo arregla una persona, no
 * el tiempo. Cuatro intentos por día alcanzan para levantar un token recién
 * arreglado sin machacar la API de Meta mientras nadie lo arregla.
 */
export const PROVISION_RETRY_HOURS = 6;
