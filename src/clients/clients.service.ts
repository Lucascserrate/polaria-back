import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
  ) {}

  create(createClientDto: CreateClientDto): Promise<Client> {
    const client = this.clientRepository.create(createClientDto);
    return this.clientRepository.save(client);
  }

  findAll(): Promise<Client[]> {
    return this.clientRepository.find();
  }

  findByTenant(tenantId: string): Promise<Client[]> {
    return this.clientRepository.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });
  }

  findOne(id: string): Promise<Client | null> {
    return this.clientRepository.findOneBy({ id });
  }

  findByTenantAndPhone(
    tenantId: string,
    phone: string,
  ): Promise<Client | null> {
    return this.clientRepository.findOneBy({ tenantId, phone });
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    await this.clientRepository.update(id, updateClientDto);
    return this.findOne(id);
  }

  async findOrCreateByPhone(
    tenantId: string,
    name: string,
    phone?: string,
  ): Promise<Client> {
    if (phone) {
      // Buscar cliente por teléfono
      const existingClient = await this.clientRepository.findOne({
        where: { tenantId, phone },
      });
      if (existingClient) {
        return existingClient;
      }
    }
    // Crear nuevo cliente
    const newClient = this.clientRepository.create({
      name,
      phone,
      tenantId,
    });
    return this.clientRepository.save(newClient);
  }

  async remove(id: string) {
    await this.clientRepository.delete(id);
    return { deleted: true };
  }
}
