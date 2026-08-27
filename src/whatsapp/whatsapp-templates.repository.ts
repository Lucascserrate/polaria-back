import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

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
}
