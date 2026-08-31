import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { isDuplicateEntryError } from '../database/duplicate-entry.util';
import { Tenant } from '../tenants/entities/tenant.entity';
import { dialCodeForTimeZone } from '../tenants/dial-code';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { resolveClientPhone, type ClientPhoneInput } from './client-phone.util';

/** Lo que se le pide al resolver para reconocer o dar de alta a alguien. */
export interface ResolveClientParams {
  tenantId: string;
  /**
   * De dónde salió el teléfono y con qué valor. Para `typed` el prefijo del país
   * es opcional: si no viene, se deduce de la zona horaria del negocio.
   */
  phone:
    | { kind: 'whatsapp'; value: string }
    | { kind: 'typed'; value: string; dialCode?: string };
  /** Con qué nombre se crea, si todavía no existía. Nunca pisa el que ya tiene. */
  name?: string | null;
}

const INVALID_PHONE_MESSAGE =
  'El teléfono no parece válido. Revisalo y probá de nuevo.';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
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

  async update(id: string, updateClientDto: UpdateClientDto) {
    await this.clientRepository.update(id, updateClientDto);
    return this.findOne(id);
  }

  /**
   * Quién es el cliente detrás de este teléfono. **El único camino** por el que
   * una reserva consigue su cliente, venga del canal que venga.
   *
   * Existe porque las tres puertas de entrada —WhatsApp, la página pública y el
   * panel— escribían el teléfono cada una a su manera, y el índice único
   * `(tenantId, phone)` sólo reconoce a la misma persona si las tres escriben
   * igual. La página normalizaba, WhatsApp guardaba el `wa_id` crudo y el panel
   * hacía un `trim()`: la misma persona entraba hasta tres veces y su historial
   * quedaba partido en tres.
   *
   * Normalizar acá adentro y no en el llamador es la parte que importa. Mientras
   * la normalización fue responsabilidad de quien llamaba, alcanzaba con que una
   * puerta nueva se olvidara de hacerla para volver a duplicar clientes, y nadie
   * se enteraba hasta que un cliente reclamaba que "no le aparecen sus turnos".
   *
   * No pisa el nombre de un cliente que ya existe: el que cargó el negocio a
   * mano —con apellido, o con "Ana la del turno de los martes"— vale más que el
   * que viene del perfil de WhatsApp. Ascenderlo cuando el guardado es peor que
   * el nuevo es una regla del asistente y vive allá.
   */
  async resolveByPhone(params: ResolveClientParams): Promise<Client> {
    const { tenantId } = params;

    const phoneInput: ClientPhoneInput =
      params.phone.kind === 'whatsapp'
        ? params.phone
        : {
            kind: 'typed',
            value: params.phone.value,
            dialCode:
              params.phone.dialCode ?? (await this.dialCodeFor(tenantId)),
          };

    const phone = resolveClientPhone(phoneInput);
    if (!phone) {
      throw new BadRequestException(INVALID_PHONE_MESSAGE);
    }

    const existing = await this.clientRepository.findOneBy({ tenantId, phone });
    if (existing) return existing;

    const name = params.name?.trim() || null;

    try {
      return await this.clientRepository.save(
        this.clientRepository.create({
          tenantId,
          phone,
          name: name ?? undefined,
        }),
      );
    } catch (error: unknown) {
      /*
       * Otro mensaje del mismo cliente llegó entre la búsqueda y la escritura.
       * Pasa de verdad: WhatsApp entrega dos webhooks casi simultáneos cuando
       * alguien manda dos mensajes seguidos, y los dos encontraban la base sin
       * el cliente. El índice único frena al segundo, y lo que corresponde es
       * quedarse con el que ganó, no devolver un 500 y perder el mensaje.
       */
      if (isDuplicateEntryError(error)) {
        const winner = await this.clientRepository.findOneBy({
          tenantId,
          phone,
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * Da de alta a alguien de quien no se tiene el teléfono.
   *
   * Es el cliente que el panel crea al reservar escribiendo sólo un nombre. Sin
   * teléfono no hay forma de reconocerlo: queda con `phone` en `NULL`, fuera del
   * índice único, y el día que esa misma persona reserve por WhatsApp va a
   * entrar como un cliente nuevo.
   *
   * Existe aparte de `resolveByPhone`, y no como un parámetro opcional suyo,
   * para que se vea que es la excepción y no una variante: acá no se resuelve
   * nada, se crea siempre. Desaparece cuando el panel pida el teléfono al elegir
   * el cliente de una reserva.
   */
  createUnidentified(tenantId: string, name: string): Promise<Client> {
    this.logger.warn(
      `Cliente creado sin teléfono desde el panel (tenantId=${tenantId}). No se va a poder reconocer en otros canales.`,
    );

    return this.clientRepository.save(
      this.clientRepository.create({
        tenantId,
        phone: null,
        name: name.trim() || undefined,
      }),
    );
  }

  async remove(id: string) {
    await this.clientRepository.delete(id);
    return { deleted: true };
  }

  /** El prefijo del país del negocio, deducido de su zona horaria. */
  private async dialCodeFor(tenantId: string): Promise<string> {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });

    return dialCodeForTimeZone(tenant?.timezone);
  }
}
