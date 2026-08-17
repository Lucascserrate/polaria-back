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

  /**
   * Sin teléfono no se reutiliza ningún cliente: siempre se crea uno nuevo.
   * Buscar por nombre fusionaría a dos personas distintas que se llaman igual, y
   * en una barbería eso pasa.
   */
  async findOrCreateByPhone(
    tenantId: string,
    name: string,
    phone?: string | null,
  ): Promise<Client> {
    // La cadena vacía se guarda como `NULL`: dos vacías chocarían en el índice
    // único `(tenantId, phone)`, y la segunda carga a mano fallaría.
    const normalizedPhone = phone?.trim() || null;

    if (normalizedPhone) {
      const existingClient = await this.clientRepository.findOne({
        where: { tenantId, phone: normalizedPhone },
      });
      if (existingClient) {
        return existingClient;
      }
    }

    const newClient = this.clientRepository.create({
      name,
      phone: normalizedPhone,
      tenantId,
    });
    return this.clientRepository.save(newClient);
  }

  async remove(id: string) {
    await this.clientRepository.delete(id);
    return { deleted: true };
  }
}
