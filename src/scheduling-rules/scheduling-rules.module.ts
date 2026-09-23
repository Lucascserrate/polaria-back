import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CategorySchedulingRule } from './entities/category-scheduling-rule.entity';
import { ServiceCategory } from '../service-categories/entities/service-category.entity';
import { SchedulingRulesService } from './scheduling-rules.service';
import { SchedulingRulesController } from './scheduling-rules.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CategorySchedulingRule, ServiceCategory]),
  ],
  controllers: [SchedulingRulesController],
  providers: [SchedulingRulesService],
  exports: [SchedulingRulesService],
})
export class SchedulingRulesModule {}
