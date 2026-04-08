import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Staff } from './entities/staff.entity';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Staff])],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
