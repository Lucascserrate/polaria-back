import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServiceCategory } from './entities/service-category.entity';
import { isDuplicateEntryError } from '../database/duplicate-entry.util';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';

/** Lo que se contesta cuando el negocio repite un nombre de categoría. */
const DUPLICATE_NAME_MESSAGE = 'Ya tenés una categoría con ese nombre.';

@Injectable()
export class ServiceCategoriesService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categoryRepository: Repository<ServiceCategory>,
  ) {}

  /**
   * Las categorías del negocio, en el orden en que se muestran.
   *
   * Por `position` y después por nombre. El desempate por nombre no es adorno:
   * hoy todas nacen con posiciones distintas, pero mientras no exista la
   * pantalla para reordenar, dos categorías importadas o creadas a la vez pueden
   * empatar, y una lista que cambia de orden entre dos recargas se lee como un
   * error.
   *
   * Incluye las vacías. Una categoría recién creada no tiene servicios todavía y
   * esconderla justo ahí sería esconderla en el único momento en que el negocio
   * la está buscando.
   */
  findByTenant(tenantId: string): Promise<ServiceCategory[]> {
    return this.categoryRepository.find({
      where: { tenantId },
      order: { position: 'ASC', name: 'ASC' },
    });
  }

  async create(
    tenantId: string,
    dto: CreateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    const category = this.categoryRepository.create({
      ...dto,
      tenantId,
      position: dto.position ?? (await this.nextPosition(tenantId)),
    });

    try {
      return await this.categoryRepository.save(category);
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(DUPLICATE_NAME_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * El final de la lista, que es donde va una categoría nueva.
   *
   * Al final y no al principio: quien agrega la séptima categoría no está
   * diciendo que sea la más importante, y meterla arriba le cambia el menú a
   * todos los clientes que ya lo conocían.
   */
  private async nextPosition(tenantId: string): Promise<number> {
    const last = await this.categoryRepository.findOne({
      where: { tenantId },
      order: { position: 'DESC' },
      select: { position: true },
    });

    return last ? last.position + 1 : 0;
  }

  async updateByTenant(
    id: string,
    tenantId: string,
    dto: UpdateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    try {
      await this.categoryRepository.update({ id, tenantId }, dto);
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(DUPLICATE_NAME_MESSAGE);
      }
      throw error;
    }

    return this.findOneOrFail(id, tenantId);
  }

  /**
   * Saca la categoría del catálogo. Los servicios que tenía se quedan.
   *
   * Borrado de verdad y no baja lógica, a diferencia de un servicio: ninguna
   * cita apunta a una categoría, así que acá no hay historial que preservar. Lo
   * que sí hay que preservar son los servicios, y de eso se encarga el
   * `ON DELETE SET NULL` de la foreign key: vuelven a quedar sin categoría, que
   * es donde estaban antes de que esto existiera.
   */
  async removeByTenant(id: string, tenantId: string): Promise<void> {
    const result = await this.categoryRepository.delete({ id, tenantId });

    if (!result.affected) {
      throw new NotFoundException('Esa categoría no existe.');
    }
  }

  /**
   * Que esta categoría exista y sea de este negocio.
   *
   * Lo usa el alta de servicios antes de guardar el `categoryId` que llegó del
   * cliente: sin esto, un id de otro negocio entra por la foreign key sin
   * quejarse —existe, es válida— y deja un servicio colgado de una categoría
   * ajena, que después aparece en la lista de alguien más.
   */
  async assertBelongsToTenant(id: string, tenantId: string): Promise<void> {
    await this.findOneOrFail(id, tenantId);
  }

  private async findOneOrFail(
    id: string,
    tenantId: string,
  ): Promise<ServiceCategory> {
    const category = await this.categoryRepository.findOne({
      where: { id, tenantId },
    });

    if (!category) {
      throw new NotFoundException('Esa categoría no existe.');
    }

    return category;
  }
}
