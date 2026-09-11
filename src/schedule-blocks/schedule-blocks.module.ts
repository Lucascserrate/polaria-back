import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ScheduleBlock } from './entities/schedule-block.entity';
import { ScheduleBlocksService } from './schedule-blocks.service';
import { ScheduleBlocksController } from './schedule-blocks.controller';
import { Staff } from '../staff/entities/staff.entity';
import { Tenant } from '../tenants/entities/tenant.entity';

/**
 * Los bloqueos son su propio módulo y no una parte de `staff`.
 *
 * El alcance es lo que lo decide: un bloqueo puede no tener profesional —ahí
 * significa todo el negocio— así que no es un atributo de una persona del
 * equipo. Y quien más lo va a consumir es el cálculo de disponibilidad, que ya
 * depende de este lado del grafo.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ScheduleBlock, Staff, Tenant])],
  controllers: [ScheduleBlocksController],
  providers: [ScheduleBlocksService],
  exports: [ScheduleBlocksService],
})
export class ScheduleBlocksModule {}
