import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { isDuplicateEntryError } from '../database/duplicate-entry.util';
import {
  SubscriptionStatus,
  trialEndsAt,
} from '../subscriptions/subscription.rules';

/**
 * Zona horaria con la que nace un negocio creado desde el registro.
 *
 * Google no informa la zona del usuario, así que se asume la de la mayoría de
 * los negocios actuales y el dueño la corrige en la configuración inicial. No es
 * un detalle menor: el horario de atención se interpreta en esta zona, y una
 * zona equivocada corre toda la agenda.
 */
export const DEFAULT_TENANT_TIMEZONE = 'America/La_Paz';

/** Nombre provisional cuando Google no informa uno. */
const FALLBACK_TENANT_NAME = 'Mi negocio';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  /**
   * Encuentra el negocio de una cuenta de Google, o lo crea.
   *
   * Es el registro self-service: antes, una cuenta que no existía como tenant
   * quedaba afuera —la whitelist no era una tabla, era justamente eso—. Ahora el
   * primer login crea el negocio con lo poco que informa Google, y el resto se
   * completa en la configuración inicial.
   *
   * El orden de búsqueda importa y se conserva del flujo anterior: primero por
   * `googleId`, después por correo. Ese segundo paso es lo que permite que un
   * negocio dado de alta por soporte —con su correo cargado y sin cuenta
   * asociada— quede vinculado al entrar por primera vez, en lugar de recibir un
   * segundo negocio vacío.
   */
  async findOrCreateByGoogleAccount(params: {
    googleId: string;
    email?: string;
    displayName?: string;
  }): Promise<Tenant> {
    const existing = await this.findByGoogleId(params.googleId);
    if (existing) return existing;

    if (params.email) {
      const byEmail = await this.findByEmail(params.email);
      if (byEmail) {
        return byEmail.googleId
          ? byEmail
          : ((await this.setGoogleId(byEmail.id, params.googleId)) ?? byEmail);
      }
    }

    try {
      const tenant = await this.create({
        name: params.displayName?.trim() || FALLBACK_TENANT_NAME,
        email: params.email,
        googleId: params.googleId,
        timezone: DEFAULT_TENANT_TIMEZONE,
      });

      this.logger.log(
        `Negocio creado por registro self-service (tenantId=${tenant.id}).`,
      );
      return tenant;
    } catch (error: unknown) {
      // Dos primeros logins simultáneos: el índice único sobre `googleId` deja
      // pasar uno solo. El que perdió lee la fila que acaba de crear el otro, en
      // lugar de fallar el registro.
      if (!isDuplicateEntryError(error)) throw error;

      const created = await this.findByGoogleId(params.googleId);
      if (!created) throw error;

      this.logger.warn(
        `Registro simultáneo resuelto por índice único (tenantId=${created.id}).`,
      );
      return created;
    }
  }

  create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    const tenant = this.tenantRepository.create(createTenantDto);
    return this.tenantRepository.save(tenant);
  }

  findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find();
  }

  findOne(id: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ id });
  }

  findByGoogleId(googleId: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ googleId });
  }

  findByEmail(email: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ email });
  }

  /**
   * Salud de la conexión de WhatsApp según Meta.
   *
   * No pasa por `UpdateTenantDto` a propósito: no es algo que el negocio edite
   * desde el panel, sino un dato que llega por webhook. Exponerlo en el PATCH
   * del tenant permitiría marcar una conexión como caída desde afuera.
   */
  async setWhatsappUnavailability(params: {
    tenantId: string;
    since: Date | null;
    reason: string | null;
  }): Promise<void> {
    await this.tenantRepository.update(params.tenantId, {
      whatsappUnavailableSince: params.since,
      whatsappUnavailableReason: params.reason,
    });
  }

  /**
   * Estado de la plantilla de recordatorios.
   *
   * Como `setWhatsappUnavailability`, no pasa por `UpdateTenantDto`: lo escribe
   * el aprovisionamiento o un webhook de Meta, nunca el negocio desde el panel.
   */
  async setReminderTemplate(params: {
    tenantId: string;
    name: string | null;
    language: string | null;
    status: string | null;
    metaStatus: string | null;
  }): Promise<void> {
    await this.tenantRepository.update(params.tenantId, {
      reminderTemplateName: params.name,
      reminderTemplateLanguage: params.language,
      reminderTemplateStatus: params.status,
      reminderTemplateMetaStatus: params.metaStatus,
    });
  }

  /** Negocios cuya plantilla está esperando la revisión de Meta. */
  findWithPendingReminderTemplate(): Promise<Tenant[]> {
    return this.tenantRepository.find({
      where: { reminderTemplateStatus: 'PENDING' },
    });
  }

  /**
   * Arranca la prueba gratuita, si no arrancó antes.
   *
   * Es idempotente por diseño y esa es la parte importante: el disparador va a
   * ser la conexión de WhatsApp, y reconectar —cambiar de número, recuperarse de
   * una caída— no puede regalar días nuevos ni reiniciar el reloj.
   *
   * Devuelve `true` solo cuando efectivamente la inició.
   */
  async startTrial(tenantId: string, now: Date = new Date()): Promise<boolean> {
    const result = await this.tenantRepository
      .createQueryBuilder()
      .update(Tenant)
      .set({
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialStartedAt: now,
        trialEndsAt: trialEndsAt(now),
      })
      .where('id = :tenantId', { tenantId })
      // La condición viaja dentro del UPDATE: si dos conexiones simultáneas
      // llegan acá, solo una modifica la fila y la prueba queda con una única
      // fecha de inicio.
      .andWhere('trialStartedAt IS NULL')
      .execute();

    const started = (result.affected ?? 0) === 1;
    if (started) {
      this.logger.log(`Prueba gratuita iniciada (tenantId=${tenantId}).`);
    }

    return started;
  }

  /** Único camino para resolver el tenant de un webhook `account_update`. */
  findByWhatsappWabaId(whatsappWabaId: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ whatsappWabaId });
  }

  findByWhatsappPhoneId(whatsappPhoneId: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ whatsappPhoneId });
  }

  findByWhatsappPhoneNumber(
    whatsappPhoneNumber: string,
  ): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ whatsappPhoneNumber });
  }

  async setGoogleId(id: string, googleId: string) {
    await this.tenantRepository.update(id, {
      googleId,
    });
    return this.findOne(id);
  }

  async update(id: string, updateTenantDto: UpdateTenantDto) {
    await this.tenantRepository.update(id, updateTenantDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.tenantRepository.delete(id);
    return { deleted: true };
  }
}
