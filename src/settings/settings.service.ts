import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessHoursService } from '../business_hours/business_hours.service';
import { TenantsService } from '../tenants/tenants.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { BookingSessionService } from '../booking-flow/booking-session.service';
import { WhatsAppTemplateService } from '../whatsapp/whatsapp-template.service';
import { TEMPLATE_KEYS, TemplateKey } from '../whatsapp/template-registry';
import { TemplateStatus } from '../whatsapp/template-status';
import { WhatsAppTemplatesRepository } from '../whatsapp/whatsapp-templates.repository';
import type { WeeklyScheduleRange } from '../schedule/weekly-schedule.util';
import { normalizeReminderOffsets } from '../reminders/reminder-offsets';
import { buildReminderPreview } from '../reminders/reminder-message';
import { REMINDER_TEMPLATE_BUTTONS } from '../whatsapp/reminder-template';
import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
import { buildPublicBookingUrl } from '../tenants/public-booking-url';
import { DataSource } from 'typeorm';
import axios, { AxiosError } from 'axios';

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
  };
}

interface MetaErrorDetails {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

interface MetaErrorResponse {
  error?: MetaErrorDetails;
}

const isMetaAxiosError = (
  error: unknown,
): error is AxiosError<MetaErrorResponse> => {
  return axios.isAxiosError<MetaErrorResponse>(error);
};

/** Media coordenada no ubica nada: o están las dos o no hay ubicación. */
const toLocation = (
  latitude?: number | null,
  longitude?: number | null,
): { latitude: number; longitude: number } | null =>
  typeof latitude === 'number' && typeof longitude === 'number'
    ? { latitude, longitude }
    : null;

/**
 * El marco del negocio: lo mínimo para dibujar cualquiera de sus pantallas.
 *
 * Es un subconjunto de `SettingsResponse` y no un tipo derivado con `Pick` a
 * propósito: lo que hace útil a este contrato es justamente que su forma no
 * dependa del otro. Si mañana la configuración gana un campo sensible, este no
 * tiene que enterarse.
 */
export type BusinessContextResponse = {
  polariaName: string;
  timezone: string;
  currency: string;
  businessHours: WeeklyScheduleRange[];
};

type SettingsResponse = {
  polariaName: string;
  /**
   * Identificador del negocio en su página pública. `null` hasta que guarda su
   * nombre por primera vez. No se edita desde el panel: ver `ensureSlug`.
   */
  slug: string | null;
  /** El enlace ya armado, que es lo que el negocio comparte. */
  publicBookingUrl: string | null;
  /** Dirección del local en texto. Ver la columna `address` del tenant. */
  address: string | null;
  /** Ver `BUSINESS_TYPES`. `null` mientras la configuración inicial no lo cargó. */
  businessType: string | null;
  timezone: string;
  /**
   * Moneda del negocio, en ISO 4217.
   *
   * La sabía solo el módulo de reportes, así que el resto del panel mostraba
   * precios sin unidad —o con una escrita a mano—. Cualquier pantalla que
   * muestre plata la necesita.
   */
  currency: string;
  /**
   * Coordenadas del local, como números.
   *
   * MySQL devuelve `decimal` como cadena; se convierte acá para que el panel no
   * tenga que saberlo.
   */
  location: { latitude: number; longitude: number } | null;
  /**
   * Horario semanal del negocio, una entrada por franja. Un día sin entradas
   * está cerrado; varias entradas en un mismo día son un turno partido.
   */
  businessHours: WeeklyScheduleRange[];
  aiEnabled: boolean;
  /**
   * Recordatorios automáticos antes de la cita.
   *
   * Va como objeto propio y no dentro de `whatsappConnection` porque es una
   * capacidad del negocio, no del canal: cuando existan correo o SMS, esta misma
   * configuración los gobierna. Si el canal está listo para entregar es otra
   * pregunta, y esa vive en `whatsappConnection.reminderTemplateStatus`.
   */
  reminders: {
    /** Anticipaciones activas, en minutos, de la más lejana a la más cercana. */
    offsets: number[];
    /**
     * El mensaje tal como lo va a recibir el cliente, con datos de ejemplo.
     *
     * Lo arma el backend con la **misma** plantilla y el mismo orden de
     * variables que usa el envío real. Si el panel lo escribiera por su cuenta,
     * la vista previa y el mensaje podrían divergir sin que nadie se entere, y
     * el negocio estaría aprobando un texto que no es el que sale.
     */
    previewText: string;
    /**
     * Botones de la plantilla, en orden.
     *
     * Van en la vista previa porque son parte de lo que ve el cliente: desde ahí
     * reagenda o cancela sin escribir nada. Salen de la plantilla aprobada, igual
     * que el texto.
     */
    previewButtons: string[];
  };
  whatsappConnection: {
    /**
     * Hay credenciales guardadas. No implica que Meta la considere sana: para
     * eso está `unavailableSince`.
     */
    connected: boolean;
    /** Cuándo Meta reportó la caída, o `null` si la conexión está sana. */
    unavailableSince: string | null;
    unavailableReason: string | null;
    /** Ver `ReminderTemplateStatus`. Solo `APPROVED` habilita recordatorios. */
    reminderTemplateStatus: string;
    /** Estado crudo de Meta, para explicar un `UNAVAILABLE`. */
    reminderTemplateMetaStatus: string | null;
    businessId: string | null;
    wabaId: string | null;
    phoneNumberId: string | null;
    phoneNumber: string | null;
    verifiedName: string | null;
    connectedAt: string | null;
    isOnBusinessApp: boolean;
    platformType: string | null;
  };
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly consumedEmbeddedSignupCodes = new Set<string>();

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly businessHoursService: BusinessHoursService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly bookingSessionService: BookingSessionService,
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
    private readonly whatsAppTemplatesRepository: WhatsAppTemplatesRepository,
  ) {}

  /**
   * Lo del negocio que cualquiera de sus pantallas necesita para dibujar.
   *
   * Existe aparte de `getSettings` porque ese payload es de administración: lleva
   * el id de la WABA, el del número y el estado de la conexión con Meta, que son
   * datos de infraestructura y no le corresponden a un profesional. Y la
   * alternativa —devolver el mismo objeto recortado según quién pregunta— daría una
   * respuesta que cambia de forma con el lector, imposible de tipar sin campos
   * opcionales que después nadie sabe cuándo están.
   *
   * Lo de acá no es sensible y sin ello no se puede dibujar un calendario: la zona
   * horaria decide qué día es hoy, y el horario decide qué franja se sombrea como
   * abierta.
   */
  async getBusinessContext(tenantId: string): Promise<BusinessContextResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const scheduleService = this.businessHoursService as unknown as {
      getTenantSchedule: (id: string) => Promise<WeeklyScheduleRange[]>;
    };

    return {
      polariaName: tenant.name,
      timezone: tenant.timezone,
      currency: tenant.currency,
      businessHours: await scheduleService.getTenantSchedule(tenantId),
    };
  }

  async getSettings(tenantId: string): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.logger.log(
      `Loading settings tenantId=${tenantId} tenantName=${tenant.name} hasWhatsappToken=${Boolean(readStoredCredential(tenant.whatsappAccessToken))} hasPhoneId=${Boolean(tenant.whatsappPhoneId)} hasWabaId=${Boolean(tenant.whatsappWabaId)}`,
    );

    const scheduleService = this.businessHoursService as unknown as {
      getTenantSchedule: (id: string) => Promise<WeeklyScheduleRange[]>;
    };
    const businessHours = await scheduleService.getTenantSchedule(tenantId);

    /*
     * El estado de la plantilla sale de `whatsapp_templates`.
     *
     * La respuesta sigue llamándolo `reminderTemplateStatus` porque es lo que el
     * panel muestra —el estado del canal de recordatorios— y renombrar el contrato
     * en el mismo cambio que muda el modelo habría mezclado dos cosas.
     */
    const reminderTemplate = await this.whatsAppTemplatesRepository.find(
      tenantId,
      TemplateKey.REMINDER,
    );

    return {
      polariaName: tenant.name,
      slug: tenant.slug,
      publicBookingUrl: buildPublicBookingUrl(
        tenant.slug,
        this.configService.get<string>('PUBLIC_SITE_BASE_URL'),
      ),
      address: tenant.address,
      businessType: tenant.businessType ?? null,
      timezone: tenant.timezone,
      currency: tenant.currency,
      location: toLocation(tenant.latitude, tenant.longitude),
      businessHours,
      aiEnabled: tenant.aiEnabled,
      reminders: {
        offsets: normalizeReminderOffsets(tenant.reminderOffsets),
        previewText: buildReminderPreview(tenant.name),
        previewButtons: [...REMINDER_TEMPLATE_BUTTONS],
      },
      whatsappConnection: {
        /**
         * Conectado es "Polaria puede operar este número", y eso lo deciden el
         * token y el id del número: son los dos que usa el webhook para resolver
         * el tenant y para responder.
         *
         * Antes también exigía la WABA, y eso escondía un estado a medias: con la
         * WABA en `NULL` y el token presente, el panel decía "sin conectar"
         * mientras Polaria seguía contestando por WhatsApp, y encima no ofrecía
         * el botón de desconectar para arreglarlo. El estado que se muestra tiene
         * que ser el que manda el comportamiento.
         */
        connected: Boolean(
          readStoredCredential(tenant.whatsappAccessToken) &&
          readStoredCredential(tenant.whatsappPhoneId),
        ),
        businessId: tenant.whatsappBusinessId ?? null,
        wabaId: tenant.whatsappWabaId ?? null,
        phoneNumberId: tenant.whatsappPhoneId ?? null,
        phoneNumber: tenant.whatsappPhoneNumber ?? null,
        verifiedName: tenant.whatsappVerifiedName ?? null,
        connectedAt: tenant.whatsappConnectedAt
          ? tenant.whatsappConnectedAt.toISOString()
          : null,
        isOnBusinessApp: Boolean(tenant.whatsappIsOnBusinessApp),
        platformType: tenant.whatsappPlatformType ?? null,
        unavailableSince: tenant.whatsappUnavailableSince
          ? tenant.whatsappUnavailableSince.toISOString()
          : null,
        unavailableReason: tenant.whatsappUnavailableReason ?? null,
        /**
         * Estado de la plantilla de recordatorios. Vive dentro de
         * `whatsappConnection` porque una plantilla pertenece a la WABA: sin
         * conexión no hay plantilla de la que hablar.
         */
        reminderTemplateStatus:
          reminderTemplate?.status ?? TemplateStatus.NOT_CREATED,
        reminderTemplateMetaStatus: reminderTemplate?.metaStatus ?? null,
      },
    };
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateSettingsDto,
  ): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.logger.log(
      `Updating settings tenantId=${tenantId} hasPolariaName=${Boolean(dto.polariaName)} hasAiEnabled=${typeof dto.aiEnabled === 'boolean'} businessHoursRanges=${dto.businessHours?.length ?? 'sin cambios'}`,
    );

    if (dto.polariaName && dto.polariaName !== tenant.name) {
      await this.tenantsService.update(tenantId, {
        name: dto.polariaName,
      });
    }

    /*
     * La dirección pública se asigna acá, con el nombre que el negocio acaba de
     * guardar, y no al registrarse: ahí el nombre lo pone Google y suele ser el
     * de la persona. `ensureSlug` no toca el de un negocio que ya tiene uno, así
     * que renombrarse no rompe los enlaces que ya circulan.
     */
    if (dto.polariaName) {
      await this.tenantsService.ensureSlug(tenantId, dto.polariaName);
    }

    if (
      dto.businessType ||
      dto.timezone ||
      dto.location !== undefined ||
      dto.address !== undefined
    ) {
      await this.tenantsService.update(tenantId, {
        businessType: dto.businessType ?? tenant.businessType ?? undefined,
        timezone: dto.timezone ?? tenant.timezone,
        // `null` explícito borra la ubicación; ausente la deja como está.
        latitude:
          dto.location === null ? null : (dto.location?.latitude ?? undefined),
        longitude:
          dto.location === null ? null : (dto.location?.longitude ?? undefined),
        // Misma regla para la dirección, y la cadena vacía se guarda como
        // `NULL`: "sin dirección" es un estado, no un texto en blanco.
        address:
          dto.address === undefined ? undefined : dto.address?.trim() || null,
      });
    }

    if (
      typeof dto.aiEnabled === 'boolean' &&
      dto.aiEnabled !== tenant.aiEnabled
    ) {
      await this.tenantsService.update(tenantId, {
        aiEnabled: dto.aiEnabled,
      });
    }

    if (dto.reminderOffsets) {
      await this.tenantsService.update(tenantId, {
        // Se normaliza antes de guardar para que la columna no acumule
        // repetidos ni desorden: lo que se lee es lo que se escribió.
        reminderOffsets: normalizeReminderOffsets(dto.reminderOffsets),
      });
    }

    if (dto.whatsappConnection) {
      const { whatsappConnection } = dto;
      const hasEmbeddedSignupPayload = Boolean(whatsappConnection.code);

      if (hasEmbeddedSignupPayload) {
        return this.completeWhatsappEmbeddedSignup(tenantId, {
          code: whatsappConnection.code,
          businessId: whatsappConnection.businessId ?? undefined,
          wabaId: whatsappConnection.wabaId ?? undefined,
          phoneNumberId: whatsappConnection.phoneNumberId ?? undefined,
          phoneNumber: whatsappConnection.phoneNumber ?? undefined,
          systemUserAccessToken:
            whatsappConnection.systemUserAccessToken ?? undefined,
        });
      }

      const incomingAccessToken = readStoredCredential(
        whatsappConnection.systemUserAccessToken,
      );

      const updatedTenant = await this.tenantsService.update(tenantId, {
        whatsappBusinessId:
          whatsappConnection.businessId ??
          tenant.whatsappBusinessId ??
          undefined,
        whatsappWabaId:
          whatsappConnection.wabaId ?? tenant.whatsappWabaId ?? undefined,
        whatsappPhoneId:
          whatsappConnection.phoneNumberId ??
          tenant.whatsappPhoneId ??
          undefined,
        whatsappPhoneNumber:
          whatsappConnection.phoneNumber ??
          tenant.whatsappPhoneNumber ??
          undefined,
        whatsappAccessToken:
          incomingAccessToken ??
          readStoredCredential(tenant.whatsappAccessToken),
      });

      if (!updatedTenant) {
        throw new NotFoundException('Tenant not found');
      }
    }

    // Ausente significa "no se tocó el horario". Un array vacío no llega hasta
    // acá: lo rechaza `replaceTenantSchedule`, porque un negocio sin ningún día
    // abierto no puede recibir reservas.
    if (dto.businessHours) {
      const scheduleService = this.businessHoursService as unknown as {
        replaceTenantSchedule: (
          id: string,
          schedule: WeeklyScheduleRange[],
        ) => Promise<void>;
      };
      await scheduleService.replaceTenantSchedule(tenantId, dto.businessHours);
    }

    return this.getSettings(tenantId);
  }

  async completeWhatsappEmbeddedSignup(
    tenantId: string,
    payload: {
      code: string;
      businessId?: string | null;
      wabaId?: string | null;
      phoneNumberId?: string | null;
      phoneNumber?: string | null;
      systemUserAccessToken?: string | null;
      coexistence?: boolean | null;
    },
  ): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.logger.log(`Starting embedded signup exchange tenantId=${tenantId}`);

    const appId = this.configService.get<string>('META_APP_ID');
    const appSecret = this.configService.get<string>('META_APP_SECRET');
    const graphVersion =
      this.configService.get<string>('META_GRAPH_VERSION') ??
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ??
      'v21.0';

    if (!appId || !appSecret) {
      throw new InternalServerErrorException(
        'Meta WhatsApp credentials are not configured',
      );
    }

    if (this.consumedEmbeddedSignupCodes.has(payload.code)) {
      throw new BadRequestException(
        'This Embedded Signup code was already consumed. Please start the flow again.',
      );
    }

    this.consumedEmbeddedSignupCodes.add(payload.code);

    const tokenEndpoint = `https://graph.facebook.com/${graphVersion}/oauth/access_token`;

    let tokenData: TokenResponse;

    try {
      const response = await axios.get<TokenResponse>(tokenEndpoint, {
        params: {
          client_id: appId,
          client_secret: appSecret,
          code: payload.code,
        },
      });

      tokenData = response.data;
    } catch (error: unknown) {
      const axiosError = isMetaAxiosError(error) ? error : null;
      const metaError = axiosError?.response?.data?.error;
      const errorMessage: string = metaError?.message ?? '';
      const safeErrorMessage =
        errorMessage ||
        (error instanceof Error ? error.message : String(error));

      this.logger.error(
        '[Embedded signup] Meta error',
        JSON.stringify({
          message: safeErrorMessage,
          code: metaError?.code,
          subcode: metaError?.error_subcode,
          type: metaError?.type,
        }),
      );

      if (metaError) {
        const normalizedErrorMessage = safeErrorMessage;
        if (
          normalizedErrorMessage.includes('verification code') ||
          normalizedErrorMessage.includes('consumed') ||
          normalizedErrorMessage.includes('already used')
        ) {
          throw new BadRequestException(
            'This Embedded Signup code was already consumed. Please start the flow again.',
          );
        }
      }

      throw error;
    }

    if (!tokenData?.access_token) {
      this.logger.error(
        `[Embedded signup] token exchange failed tenantId=${tenantId} missing access_token`,
      );
      throw new BadRequestException(
        tokenData?.error?.message ??
          'Unable to exchange the Embedded Signup authorization code',
      );
    }

    const systemUserAccessToken =
      readStoredCredential(payload.systemUserAccessToken) ??
      tokenData.access_token;

    this.logger.log(`Embedded signup token exchange OK tenantId=${tenantId}`);

    const graphBaseUrl = `https://graph.facebook.com/${graphVersion}`;
    const graphGet = async <T>(path: string, accessToken: string) => {
      const response = await fetch(`${graphBaseUrl}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = (await response.json()) as T & {
        error?: { message?: string; type?: string; code?: number };
      };

      if (!response.ok) {
        this.logger.error(
          `Embedded signup Graph request failed tenantId=${tenantId} path=${path} status=${response.status}`,
        );
        throw new BadRequestException(
          data.error?.message ?? `Graph API request failed for ${path}`,
        );
      }

      return data;
    };

    const graphPost = async <T>(
      path: string,
      accessToken: string,
      body?: Record<string, unknown>,
    ) => {
      const response = await fetch(`${graphBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json()) as T & {
        error?: { message?: string; type?: string; code?: number };
      };

      if (!response.ok) {
        this.logger.error(
          `Embedded signup Graph POST failed tenantId=${tenantId} path=${path} status=${response.status} message=${data.error?.message ?? ''}`,
        );
        throw new BadRequestException(
          data.error?.message ?? `Graph API request failed for ${path}`,
        );
      }

      return data;
    };

    this.logger.log(`Embedded signup Graph data obtained tenantId=${tenantId}`);

    const discoveredBusinessId = payload.businessId ?? null;

    if (!discoveredBusinessId) {
      throw new BadRequestException(
        'Meta did not return a business_id in the Embedded Signup payload',
      );
    }

    const discoveredWabaId = payload.wabaId ?? null;
    if (!discoveredWabaId) {
      throw new BadRequestException(
        'Meta did not return a WhatsApp Business Account (WABA)',
      );
    }

    type PhoneNumberNode = {
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      platform_type?: string;
      is_on_biz_app?: boolean;
    };
    const wabaPhoneNumbers = await graphGet<{ data?: PhoneNumberNode[] }>(
      `/${discoveredWabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,is_on_biz_app`,
      systemUserAccessToken,
    );

    // El flujo puede devolver una WABA con más de un número: se prioriza el que
    // Meta reportó en la sesión de Embedded Signup.
    const phoneNumberNode =
      (payload.phoneNumberId
        ? wabaPhoneNumbers.data?.find(
            (node) => node.id === payload.phoneNumberId,
          )
        : undefined) ?? wabaPhoneNumbers.data?.[0];

    const discoveredPhoneNumberId =
      phoneNumberNode?.id ?? payload.phoneNumberId ?? null;
    const discoveredPhoneNumber =
      phoneNumberNode?.display_phone_number ?? payload.phoneNumber ?? null;
    const discoveredVerifiedName = phoneNumberNode?.verified_name ?? null;
    const discoveredPlatformType = phoneNumberNode?.platform_type ?? null;

    // Coexistence se confirma con el estado real del número en Graph; el flag
    // del cliente solo es un fallback si Meta todavía no propagó el campo.
    const isOnBusinessApp =
      phoneNumberNode?.is_on_biz_app ?? Boolean(payload.coexistence);

    if (
      !discoveredWabaId ||
      !discoveredPhoneNumberId ||
      !discoveredPhoneNumber
    ) {
      throw new BadRequestException(
        'Meta did not return the expected business, WABA, or phone number data',
      );
    }

    // Va después de validar el número y no antes: si la WABA no trae uno usable,
    // el signup se cae igual, y suscribirse primero deja la app enganchada a los
    // webhooks de una cuenta que este negocio nunca va a usar.
    //
    // Sin esta suscripción Meta no entrega los webhooks de la WABA recién
    // vinculada (mensajes, y en Coexistence también echoes e historial).
    try {
      await graphPost(
        `/${discoveredWabaId}/subscribed_apps`,
        systemUserAccessToken,
      );
      this.logger.log(
        `Embedded signup subscribed app to WABA tenantId=${tenantId} wabaId=${discoveredWabaId}`,
      );
    } catch (error: unknown) {
      // Reintentar el signup no debería fallar solo porque la app ya estaba
      // suscrita; se registra y se sigue.
      this.logger.warn(
        `Embedded signup could not subscribe app to WABA tenantId=${tenantId} wabaId=${discoveredWabaId} message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (isOnBusinessApp) {
      this.logger.log(
        `Embedded signup coexistence detected tenantId=${tenantId} phoneNumberId=${discoveredPhoneNumberId} platformType=${String(discoveredPlatformType)}`,
      );
      // En Coexistence el número ya está registrado por la app de WhatsApp
      // Business: no se llama a /register, solo se sincronizan datos.
      await this.syncBusinessAppData(
        tenantId,
        discoveredPhoneNumberId,
        systemUserAccessToken,
        graphPost,
      );
    }

    /*
     * Si el negocio cambia de WABA, las plantillas de la anterior se sueltan.
     *
     * La bandera se levanta dentro de la transacción y se actúa afuera: las
     * plantillas están en otra tabla y su borrado no tiene por qué compartir el
     * bloqueo de la fila del tenant.
     */
    let releasesTemplates = false;

    const updatedTenant = await this.dataSource.transaction(async (manager) => {
      const tenantRepository = manager.getRepository(Tenant);

      const lockedTenant = await tenantRepository.findOne({
        where: { id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedTenant) {
        throw new NotFoundException('Tenant not found');
      }

      const tenantWithSamePhone = await tenantRepository
        .createQueryBuilder('tenant')
        .setLock('pessimistic_write')
        .where('tenant.whatsappPhoneId = :phoneId', {
          phoneId: discoveredPhoneNumberId,
        })
        .andWhere('tenant.id != :tenantId', { tenantId })
        .getOne();
      if (tenantWithSamePhone) {
        throw new ConflictException(
          'This WhatsApp phone number is already connected to another tenant',
        );
      }

      const tenantWithSameWaba = await tenantRepository
        .createQueryBuilder('tenant')
        .setLock('pessimistic_write')
        .where('tenant.whatsappWabaId = :wabaId', { wabaId: discoveredWabaId })
        .andWhere('tenant.id != :tenantId', { tenantId })
        .getOne();
      if (tenantWithSameWaba) {
        throw new ConflictException(
          'This WhatsApp Business Account is already connected to another tenant',
        );
      }

      // `whatsappPhoneNumber` tiene índice único, así que sin este chequeo la
      // colisión salía como error de duplicado de MySQL: un 500 que no le dice
      // nada al negocio, en vez del mismo 409 que ya devuelven las otras dos.
      const tenantWithSamePhoneNumber = await tenantRepository
        .createQueryBuilder('tenant')
        .setLock('pessimistic_write')
        .where('tenant.whatsappPhoneNumber = :phoneNumber', {
          phoneNumber: discoveredPhoneNumber,
        })
        .andWhere('tenant.id != :tenantId', { tenantId })
        .getOne();
      if (tenantWithSamePhoneNumber) {
        throw new ConflictException(
          'This WhatsApp phone number is already connected to another tenant',
        );
      }

      /**
       * Cambio de número: el negocio conserva su tenant y toda su configuración
       * —servicios, staff, horarios, historial—, y solo se reemplazan los datos
       * de la conexión.
       *
       * El Flow es la excepción: pertenece a una WABA, así que si la WABA cambió,
       * el id guardado apunta a un formulario que ya no podemos abrir. Dejarlo
       * haría que el flujo de reserva intentara usarlo y fallara en cada intento;
       * limpiándolo, se cae solo al canal nativo de listas y botones.
       */
      const wabaChanged =
        Boolean(lockedTenant.whatsappWabaId) &&
        lockedTenant.whatsappWabaId !== discoveredWabaId;

      if (wabaChanged) {
        this.logger.log(
          `Embedded signup replaced WABA tenantId=${tenantId} previousWabaId=${String(
            lockedTenant.whatsappWabaId,
          )} newWabaId=${discoveredWabaId}; clearing whatsappFlowId`,
        );
        lockedTenant.whatsappFlowId = null;
        /*
         * Igual que el Flow: las plantillas pertenecen a la WABA anterior y no se
         * pueden enviar desde la nueva.
         *
         * Se anota para borrarlas **después** de la transacción y no adentro: viven
         * en otra tabla y su borrado no tiene por qué compartir el bloqueo de la
         * fila del tenant. `provisionTemplates`, más abajo, las vuelve a crear
         * contra la WABA nueva.
         */
        releasesTemplates = true;
      }

      lockedTenant.whatsappBusinessId = discoveredBusinessId;
      lockedTenant.whatsappWabaId = discoveredWabaId;
      lockedTenant.whatsappPhoneId = discoveredPhoneNumberId;
      lockedTenant.whatsappPhoneNumber = discoveredPhoneNumber;
      lockedTenant.whatsappVerifiedName = discoveredVerifiedName ?? null;
      lockedTenant.whatsappIsOnBusinessApp = isOnBusinessApp;
      lockedTenant.whatsappPlatformType = discoveredPlatformType ?? null;
      lockedTenant.whatsappAccessToken = systemUserAccessToken;
      lockedTenant.whatsappConnectedAt = new Date();
      // Reconectar cierra cualquier caída que Meta hubiera reportado: si el
      // negocio acaba de completar el signup, la conexión que estaba caída ya no
      // es la que tiene.
      lockedTenant.whatsappUnavailableSince = null;
      lockedTenant.whatsappUnavailableReason = null;

      const savedTenant = await tenantRepository.save(lockedTenant);
      this.logger.log(`Embedded signup tenant updated tenantId=${tenantId}`);

      return savedTenant;
    });

    if (!updatedTenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (releasesTemplates) {
      await this.whatsAppTemplatesRepository.deleteByTenant(tenantId);
    }

    await this.provisionTemplates({
      tenantId,
      wabaId: discoveredWabaId,
      accessToken: systemUserAccessToken,
    });

    await this.startTrialOnFirstConnection(tenantId);

    return this.getSettings(tenantId);
  }

  /**
   * Arranca la prueba gratuita cuando el negocio conecta WhatsApp.
   *
   * Este es el momento y no el registro: recién acá Polaria puede hacer algo por
   * él. Si la prueba empezara al entrar con Google, alguien que abandona el
   * onboarding cinco días perdería cinco días sin haber usado el producto.
   *
   * `startTrial` es idempotente —la condición `trialStartedAt IS NULL` viaja
   * dentro del UPDATE—, así que reconectar, cambiar de número o recuperarse de
   * una caída no reinicia el reloj ni regala días.
   *
   * Va después de la transacción y no adentro: un fallo acá deja al negocio
   * conectado y sin prueba iniciada, que es el estado que **sí** da acceso
   * (`NOT_STARTED`). Al revés —abortar la conexión porque no se pudo escribir una
   * fecha— sería cambiar un problema de facturación por uno de producto.
   */
  private async startTrialOnFirstConnection(tenantId: string): Promise<void> {
    try {
      await this.tenantsService.startTrial(tenantId);
    } catch (error: unknown) {
      // En `error` y no en `warn`: nadie lo nota desde afuera, porque el negocio
      // sigue teniendo acceso, y el log es la única forma de enterarse.
      this.logger.error(
        `No se pudo iniciar la prueba gratuita (tenantId=${tenantId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Deja listas las plantillas de este negocio.
   *
   * Corre después de guardar la conexión y es best-effort, como la suscripción a
   * webhooks: si Meta rechaza una creación, el negocio queda conectado y sin esa
   * plantilla. Fallar el signup entero por esto sería desproporcionado —el canal
   * principal, que es recibir y responder mensajes, funciona igual.
   *
   * Se recorren todas y no solo la de recordatorios: cada una se aprueba por
   * separado, así que una rechazada no puede impedir que las otras se creen.
   */
  private async provisionTemplates(params: {
    tenantId: string;
    wabaId: string;
    accessToken: string;
  }): Promise<void> {
    for (const key of TEMPLATE_KEYS) {
      const state = await this.whatsAppTemplateService.provisionTemplate({
        ...params,
        key,
      });

      // `NOT_CREATED` significa que no se pudo crear: no se guarda una fila que
      // afirme tener una plantilla que Meta no conoce.
      if (state.status === TemplateStatus.NOT_CREATED) continue;

      await this.whatsAppTemplatesRepository.save({
        tenantId: params.tenantId,
        templateKey: key,
        name: state.name,
        language: state.language,
        status: state.status,
        metaStatus: state.metaStatus,
      });
    }
  }

  /**
   * Desconecta WhatsApp del lado de Polaria.
   *
   * **No toca nada en Meta.** El número sigue existiendo en su WABA, la WABA en
   * su portfolio y nuestra app sigue suscrita a sus webhooks. Lo único que
   * cambia es que Polaria deja de considerar esa conexión como suya, y el
   * negocio puede volver a conectarla cuando quiera con Embedded Signup.
   *
   * Se limpian los campos en vez de marcar un flag porque limpiarlos es lo que
   * hace efectiva la desconexión: el webhook resuelve el tenant por
   * `whatsappPhoneId` con respaldo en `whatsappPhoneNumber`, y sin ninguno de
   * los dos deja de encontrarlo. Un flag habría exigido comprobarlo en el ruteo,
   * en la resolución de credenciales y en cada lugar futuro; el primero que se
   * olvidara dejaría a Polaria contestando en un número "desconectado".
   *
   * Y hay una razón que no es técnica: el número y la WABA participan de
   * chequeos de exclusividad —el índice único y los 409 del signup—. Un tenant
   * desconectado que los retuviera impediría para siempre que ese mismo número
   * se conectara en otra cuenta, que es justo el caso del número personal de una
   * empleada conectado por error.
   */
  async disconnectWhatsapp(tenantId: string): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const tenantRepository = manager.getRepository(Tenant);

      const lockedTenant = await tenantRepository.findOne({
        where: { id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedTenant) {
        throw new NotFoundException('Tenant not found');
      }

      // Todo va a `null`, nunca a `undefined`: TypeORM saltea las propiedades
      // `undefined` al guardar, así que asignarlas dejaba la columna intacta. Es
      // lo que hacía que la desconexión se viera hecha en el panel mientras el
      // token seguía guardado y Polaria seguía respondiendo por WhatsApp.
      lockedTenant.whatsappBusinessId = null;
      lockedTenant.whatsappWabaId = null;
      lockedTenant.whatsappPhoneId = null;
      lockedTenant.whatsappPhoneNumber = null;
      lockedTenant.whatsappVerifiedName = null;
      lockedTenant.whatsappAccessToken = null;
      // El Flow pertenece a la WABA que se está soltando.
      lockedTenant.whatsappFlowId = null;
      lockedTenant.whatsappConnectedAt = null;
      lockedTenant.whatsappIsOnBusinessApp = false;
      lockedTenant.whatsappPlatformType = null;
      // Una caída informada por Meta deja de tener sentido sin conexión.
      lockedTenant.whatsappUnavailableSince = null;
      lockedTenant.whatsappUnavailableReason = null;

      await tenantRepository.save(lockedTenant);

      const cancelledSessions =
        await this.bookingSessionService.cancelOpenByTenant({
          tenantId,
          now,
          reason: 'WHATSAPP_DISCONNECTED',
          manager,
        });

      this.logger.log(
        `WhatsApp desconectado tenantId=${tenantId} phoneNumber=${String(
          tenant.whatsappPhoneNumber,
        )} wabaId=${String(tenant.whatsappWabaId)} sesionesCanceladas=${cancelledSessions}`,
      );
    });

    /*
     * Las plantillas se sueltan con la conexión.
     *
     * Pertenecen a la WABA que se está dejando, así que conservarlas dejaría filas
     * que afirman tener una plantilla aprobada en una WABA que ya no es de este
     * negocio. Al reconectar, `provisionTemplates` las vuelve a crear.
     *
     * Fuera de la transacción por lo mismo que el resto: otra tabla, otro bloqueo.
     */
    await this.whatsAppTemplatesRepository.deleteByTenant(tenantId);

    return this.getSettings(tenantId);
  }

  /**
   * Coexistence: pide a Meta que empuje los contactos y el historial (últimos
   * 180 días) de la app de WhatsApp Business hacia los webhooks
   * `smb_app_state_sync` e `history`.
   *
   * Cada sync corre una sola vez por onboarding y hay 24 h desde que termina
   * Embedded Signup para dispararlo; pasado ese plazo el negocio tiene que
   * volver a conectarse. Es best-effort: si falla, la conexión igual queda
   * usable para mensajería y solo se pierde el arrastre de datos.
   */
  private async syncBusinessAppData(
    tenantId: string,
    phoneNumberId: string,
    accessToken: string,
    graphPost: <T>(
      path: string,
      accessToken: string,
      body?: Record<string, unknown>,
    ) => Promise<T>,
  ): Promise<void> {
    const syncTypes = ['smb_app_state_sync', 'history'] as const;

    for (const syncType of syncTypes) {
      try {
        await graphPost(`/${phoneNumberId}/smb_app_data`, accessToken, {
          messaging_product: 'whatsapp',
          sync_type: syncType,
        });
        this.logger.log(
          `Coexistence sync requested tenantId=${tenantId} phoneNumberId=${phoneNumberId} syncType=${syncType}`,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Coexistence sync failed tenantId=${tenantId} phoneNumberId=${phoneNumberId} syncType=${syncType} message=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
