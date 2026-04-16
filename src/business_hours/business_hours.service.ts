import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BusinessHour } from './entities/business_hour.entity';
import { CreateBusinessHourDto } from './dto/create-business_hour.dto';
import { UpdateBusinessHourDto } from './dto/update-business_hour.dto';

type BusinessHoursSettingsResponse = {
  workingDays: boolean[];
  openingHours: { from: string; to: string } | null;
};

type UpdateTenantHoursSettingsPayload = {
  workingDays?: boolean[];
  openingHours?: { from: string; to: string };
};

const normalizeTime = (value: string): string => {
  if (!value) return '00:00';
  return value.length >= 5 ? value.slice(0, 5) : value;
};

@Injectable()
export class BusinessHoursService {
  constructor(
    @InjectRepository(BusinessHour)
    private businessHourRepository: Repository<BusinessHour>,
  ) {}

  create(createBusinessHourDto: CreateBusinessHourDto): Promise<BusinessHour> {
    const businessHour = this.businessHourRepository.create(
      createBusinessHourDto,
    );
    return this.businessHourRepository.save(businessHour);
  }

  findAll(): Promise<BusinessHour[]> {
    return this.businessHourRepository.find();
  }

  findOne(id: string): Promise<BusinessHour | null> {
    return this.businessHourRepository.findOneBy({ id });
  }

  findByTenant(tenantId: string): Promise<BusinessHour[]> {
    return this.businessHourRepository.find({
      where: { tenantId },
      order: { dayOfWeek: 'ASC' },
    });
  }

  async getTenantHoursSettings(
    tenantId: string,
  ): Promise<BusinessHoursSettingsResponse> {
    const businessHours = await this.findByTenant(tenantId);

    const workingDays = Array.from({ length: 7 }, () => false);
    let openingHours: { from: string; to: string } | null = null;

    if (businessHours.length > 0) {
      const first = businessHours[0];
      openingHours = {
        from: normalizeTime(first.startTime),
        to: normalizeTime(first.endTime),
      };

      for (const hour of businessHours) {
        workingDays[hour.dayOfWeek] = true;
      }
    }

    return { workingDays, openingHours };
  }

  async updateTenantHoursSettings(
    tenantId: string,
    dto: UpdateTenantHoursSettingsPayload,
  ): Promise<BusinessHoursSettingsResponse> {
    if (dto.workingDays || dto.openingHours) {
      if (!dto.workingDays || !dto.openingHours) {
        throw new BadRequestException(
          'workingDays and openingHours are required together',
        );
      }

      const existing = await this.findByTenant(tenantId);
      const byDay = new Map(existing.map((item) => [item.dayOfWeek, item]));
      const startTime = normalizeTime(dto.openingHours.from);
      const endTime = normalizeTime(dto.openingHours.to);

      for (let day = 0; day < 7; day += 1) {
        const shouldOpen = dto.workingDays[day];
        const current = byDay.get(day);

        if (shouldOpen) {
          if (current) {
            if (
              normalizeTime(current.startTime) !== startTime ||
              normalizeTime(current.endTime) !== endTime
            ) {
              await this.update(current.id, {
                startTime,
                endTime,
              });
            }
          } else {
            await this.create({
              tenantId,
              dayOfWeek: day,
              startTime,
              endTime,
            });
          }
        } else if (current) {
          await this.remove(current.id);
        }
      }
    }

    return this.getTenantHoursSettings(tenantId);
  }

  async update(id: string, updateBusinessHourDto: UpdateBusinessHourDto) {
    await this.businessHourRepository.update(id, updateBusinessHourDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.businessHourRepository.delete(id);
    return { deleted: true };
  }
}
