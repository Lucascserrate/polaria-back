import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { isDuplicateEntryError } from '../database/duplicate-entry.util';
import {
  extendTrial,
  SubscriptionStatus,
  trialEndsAt,
} from '../subscriptions/subscription.rules';
import { DEFAULT_REMINDER_OFFSETS } from '../reminders/reminder-offsets';
import { buildUniqueSlug } from './slug.util';

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
    const tenant = this.tenantRepository.create({
      ...createTenantDto,
      // Un negocio nuevo arranca con el aviso del día anterior. Va acá y no como
      // default de la columna porque MySQL no admite un default literal en JSON,
      // y así los dos caminos de alta —registro y soporte— lo comparten.
      reminderOffsets:
        createTenantDto.reminderOffsets ?? DEFAULT_REMINDER_OFFSETS,
    });
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

  /** El negocio detrás de `polariahq.com/[slug]`. */
  findBySlug(slug: string): Promise<Tenant | null> {
    return this.tenantRepository.findOneBy({ slug: slug.toLowerCase() });
  }

  /**
   * Le da al negocio su dirección pública, si todavía no tiene una.
   *
   * Se llama cuando el negocio guarda su nombre —la configuración inicial es la
   * primera vez— y no al registrarse: ahí el nombre lo pone Google y suele ser
   * el de la persona, así que "lucas-serrate" quedaría como la URL de una
   * barbería para siempre.
   *
   * Y **sólo si todavía no tiene**: renombrarse no cambia el slug. Un enlace ya
   * está pegado en un QR sobre el mostrador, en la biografía de Instagram y en
   * las conversaciones de los clientes; que cambiar el nombre en la
   * configuración rompiera todo eso en silencio sería una trampa. El día que un
   * negocio quiera cambiarlo va a ser una decisión suya y explícita, con el
   * aviso correspondiente.
   *
   * Devuelve el slug vigente, tanto el recién asignado como el que ya estaba.
   */
  async ensureSlug(tenantId: string, name: string): Promise<string | null> {
    const tenant = await this.findOne(tenantId);
    if (!tenant) return null;
    if (tenant.slug) return tenant.slug;

    /*
     * Se leen todos los slugs para desempatar. Son una fila por negocio y una
     * columna corta: mientras la cartera entre en memoria —y falta muchísimo—,
     * esto es más simple y más obvio que reintentar contra el índice único.
     */
    const rows = await this.tenantRepository.find({ select: { slug: true } });
    const taken = rows
      .map((row) => row.slug)
      .filter((slug): slug is string => Boolean(slug));

    const slug = buildUniqueSlug(name, taken);

    try {
      await this.tenantRepository.update(tenantId, { slug });
      return slug;
    } catch (error: unknown) {
      // Dos negocios guardando el mismo nombre a la vez: el índice único deja
      // pasar uno. El que perdió se queda sin slug esta vez y lo consigue en el
      // próximo guardado, que es preferible a fallar el guardado entero por algo
      // que el negocio no pidió.
      if (!isDuplicateEntryError(error)) throw error;

      this.logger.warn(
        `Slug tomado por otro negocio en paralelo (tenantId=${tenantId}, slug=${slug}).`,
      );
      return null;
    }
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

  /**
   * Le da más prueba gratuita a un negocio. Lo pide soporte.
   *
   * Va acá y no en `support/` porque es el segundo escritor del mismo reloj que
   * `startTrial`, y las dos formas de mover `trialEndsAt` conviene leerlas
   * juntas. Lo que sí vive en `support/` es la ruta: es lo que se lleva el
   * repositorio de administración cuando se separe.
   *
   * A diferencia de `startTrial`, esto **no** es idempotente y no debe serlo:
   * apretar dos veces "+7 días" son catorce días, no siete. Por eso la decisión
   * es explícita —alguien la toma en una pantalla— y por eso queda en el log.
   *
   * La regla de cuánto y desde cuándo está en `extendTrial`, que es pura. Acá
   * sólo queda cargar, escribir y contar.
   */
  async extendTrial(
    tenantId: string,
    days: number,
    now: Date = new Date(),
  ): Promise<Tenant> {
    const tenant = await this.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const outcome = extendTrial(
      {
        subscriptionStatus: tenant.subscriptionStatus,
        trialStartedAt: tenant.trialStartedAt ?? null,
        trialEndsAt: tenant.trialEndsAt ?? null,
      },
      days,
      now,
    );

    if (!outcome.granted) {
      throw new ConflictException(
        outcome.reason === 'PAID_SUBSCRIPTION'
          ? 'Este negocio ya tiene una suscripción paga: extenderle la prueba lo bajaría de categoría.'
          : 'La extensión tiene que ser un número de días positivo.',
      );
    }

    await this.tenantRepository.update(tenantId, {
      subscriptionStatus: SubscriptionStatus.TRIAL,
      trialStartedAt: outcome.trialStartedAt,
      trialEndsAt: outcome.trialEndsAt,
    });

    /*
     * En `log` y con las dos fechas: es la única huella de que alguien regaló
     * producto. No hay auditoría en Polaria todavía, así que esta línea es lo
     * que permite reconstruir después quién tenía prueba y hasta cuándo.
     */
    this.logger.log(
      `Prueba extendida ${days} días (tenantId=${tenantId}, desde=${
        tenant.trialEndsAt?.toISOString() ?? 'sin prueba'
      }, hasta=${outcome.trialEndsAt.toISOString()}).`,
    );

    const updated = await this.findOne(tenantId);
    if (!updated) {
      throw new NotFoundException('Tenant not found');
    }

    return updated;
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
