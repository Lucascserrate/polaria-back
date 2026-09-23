import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ServiceCategory } from '../service-categories/entities/service-category.entity';
import { CategorySchedulingRule } from './entities/category-scheduling-rule.entity';
import { SchedulingMode } from './scheduling-mode';
import { ParallelPairs, canonicalPair } from './parallel-pairs';

@Injectable()
export class SchedulingRulesService {
  constructor(
    @InjectRepository(CategorySchedulingRule)
    private readonly ruleRepository: Repository<CategorySchedulingRule>,
    @InjectRepository(ServiceCategory)
    private readonly categoryRepository: Repository<ServiceCategory>,
  ) {}

  /** Todas las reglas del negocio, tal como están guardadas. */
  findByTenant(tenantId: string): Promise<CategorySchedulingRule[]> {
    return this.ruleRepository.find({ where: { tenantId } });
  }

  /**
   * Las reglas de simultaneidad del negocio, listas para el planificador.
   *
   * Se leen todas de una y no par por par: son unas pocas filas por negocio —una
   * por cada dos categorías que conviven— y el planificador pregunta muchas
   * veces, una por cada par de servicios de cada plan que evalúa. Una consulta
   * por pregunta sería una consulta dentro de un bucle dentro de otro bucle.
   */
  async getParallelPairs(tenantId: string): Promise<ParallelPairs> {
    const rules = await this.ruleRepository.find({
      where: { tenantId, mode: SchedulingMode.PARALLEL },
      select: { categoryAId: true, categoryBId: true },
    });

    return new ParallelPairs(rules);
  }

  /**
   * Con qué otras categorías convive ésta.
   *
   * La regla está guardada una sola vez, con el par ordenado por id, así que hay
   * que mirar las dos columnas: la categoría puede ser la "A" de una fila y la
   * "B" de otra. Quien pregunta no tiene por qué saberlo.
   */
  async findParallelCategoryIds(
    tenantId: string,
    categoryId: string,
  ): Promise<string[]> {
    const rules = await this.ruleRepository.find({
      where: [
        { tenantId, categoryAId: categoryId, mode: SchedulingMode.PARALLEL },
        { tenantId, categoryBId: categoryId, mode: SchedulingMode.PARALLEL },
      ],
    });

    return rules
      .map((rule) =>
        rule.categoryAId === categoryId ? rule.categoryBId : rule.categoryAId,
      )
      .sort();
  }

  /**
   * Deja a esta categoría conviviendo exactamente con las que se indican.
   *
   * Reemplaza en vez de agregar porque es lo que la pantalla tiene en la mano:
   * una lista de casillas, y lo que el negocio ve al guardar es el estado
   * completo, no un diferencial. Con un `add` y un `remove` sueltos, dos
   * pestañas abiertas podrían dejar marcado algo que en la pantalla estaba
   * desmarcado.
   *
   * En una transacción: borrar las que sobran y escribir las que faltan son dos
   * mitades de una sola operación, y a medio camino la categoría queda sin las
   * reglas que tenía. Eso no rompe ninguna cita ya agendada —los horarios ya
   * están escritos— pero sí cambia lo que se le ofrece a quien esté reservando
   * en ese momento.
   */
  async setParallelCategories(
    tenantId: string,
    categoryId: string,
    otherIds: string[],
  ): Promise<string[]> {
    const wanted = [...new Set(otherIds)];

    if (wanted.includes(categoryId)) {
      throw new BadRequestException(
        'Una categoría no se puede hacer al mismo tiempo que ella misma.',
      );
    }

    await this.assertCategoriesBelongToTenant(tenantId, [
      categoryId,
      ...wanted,
    ]);

    await this.ruleRepository.manager.transaction(async (manager) => {
      const current = await manager.find(CategorySchedulingRule, {
        where: [
          { tenantId, categoryAId: categoryId, mode: SchedulingMode.PARALLEL },
          { tenantId, categoryBId: categoryId, mode: SchedulingMode.PARALLEL },
        ],
      });

      const keep = new Set(wanted);

      const obsolete = current.filter((rule) => {
        const other =
          rule.categoryAId === categoryId ? rule.categoryBId : rule.categoryAId;
        return !keep.has(other);
      });

      if (obsolete.length > 0) {
        await manager.delete(
          CategorySchedulingRule,
          obsolete.map((rule) => rule.id),
        );
      }

      const existing = new Set(
        current.map((rule) =>
          rule.categoryAId === categoryId ? rule.categoryBId : rule.categoryAId,
        ),
      );

      const missing = wanted.filter((other) => !existing.has(other));
      if (missing.length === 0) return;

      await manager.save(
        missing.map((other) =>
          manager.create(CategorySchedulingRule, {
            tenantId,
            ...canonicalPair(categoryId, other),
            mode: SchedulingMode.PARALLEL,
          }),
        ),
      );
    });

    return this.findParallelCategoryIds(tenantId, categoryId);
  }

  /**
   * Que todas las categorías existan y sean de este negocio.
   *
   * Sin esto, un id de otro negocio entra por la foreign key sin quejarse
   * —existe, es válida— y deja una regla que habla de una categoría ajena. Es el
   * mismo cuidado que toma `ServiceCategoriesService.assertBelongsToTenant` al
   * guardar el `categoryId` de un servicio, y hace falta acá de nuevo porque
   * esta tabla tiene sus propias foreign keys.
   */
  private async assertCategoriesBelongToTenant(
    tenantId: string,
    categoryIds: string[],
  ): Promise<void> {
    const unique = [...new Set(categoryIds)];
    if (unique.length === 0) return;

    const found = await this.categoryRepository.count({
      where: { id: In(unique), tenantId },
    });

    if (found !== unique.length) {
      throw new BadRequestException(
        'Alguna de esas categorías no existe en tu negocio.',
      );
    }
  }
}
