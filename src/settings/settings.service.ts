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
import { ReminderTemplateStatus } from '../whatsapp/reminder-template';
import type { WeeklyScheduleRange } from '../schedule/weekly-schedule.util';
import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
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

type SettingsResponse = {
  polariaName: string;
  /** Ver `BUSINESS_TYPES`. `null` mientras la configuración inicial no lo cargó. */
  businessType: string | null;
  timezone: string;
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
    enabled: boolean;
    leadMinutes: number;
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
  ) {}

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

    return {
      polariaName: tenant.name,
      businessType: tenant.businessType ?? null,
      timezone: tenant.timezone,
      location: toLocation(tenant.latitude, tenant.longitude),
      businessHours,
      aiEnabled: tenant.aiEnabled,
      reminders: {
        enabled: tenant.remindersEnabled,
        leadMinutes: tenant.reminderLeadMinutes,
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
          tenant.reminderTemplateStatus ?? ReminderTemplateStatus.NOT_CREATED,
        reminderTemplateMetaStatus: tenant.reminderTemplateMetaStatus ?? null,
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

    if (dto.businessType || dto.timezone || dto.location !== undefined) {
      await this.tenantsService.update(tenantId, {
        businessType: dto.businessType ?? tenant.businessType ?? undefined,
        timezone: dto.timezone ?? tenant.timezone,
        // `null` explícito borra la ubicación; ausente la deja como está.
        latitude:
          dto.location === null ? null : (dto.location?.latitude ?? undefined),
        longitude:
          dto.location === null ? null : (dto.location?.longitude ?? undefined),
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

    if (
      typeof dto.remindersEnabled === 'boolean' ||
      typeof dto.reminderLeadMinutes === 'number'
    ) {
      await this.tenantsService.update(tenantId, {
        remindersEnabled: dto.remindersEnabled ?? tenant.remindersEnabled,
        reminderLeadMinutes:
          dto.reminderLeadMinutes ?? tenant.reminderLeadMinutes,
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
        // Igual que el Flow: la plantilla pertenece a la WABA anterior. Se
        // reaprovisiona más abajo contra la nueva.
        lockedTenant.reminderTemplateName = null;
        lockedTenant.reminderTemplateLanguage = null;
        lockedTenant.reminderTemplateStatus = null;
        lockedTenant.reminderTemplateMetaStatus = null;
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

    await this.provisionReminderTemplate({
      tenantId,
      wabaId: discoveredWabaId,
      accessToken: systemUserAccessToken,
    });

    return this.getSettings(tenantId);
  }

  /**
   * Deja lista la plantilla de recordatorios de este negocio.
   *
   * Corre después de guardar la conexión y es best-effort, como la suscripción a
   * webhooks: si Meta rechaza la creación, el negocio queda conectado y sin
   * recordatorios. Fallar el signup entero por esto sería desproporcionado —el
   * canal principal, que es recibir y responder mensajes, funciona igual.
   */
  private async provisionReminderTemplate(params: {
    tenantId: string;
    wabaId: string;
    accessToken: string;
  }): Promise<void> {
    const state =
      await this.whatsAppTemplateService.provisionReminderTemplate(params);

    await this.tenantsService.setReminderTemplate({
      tenantId: params.tenantId,
      name:
        state.status === ReminderTemplateStatus.NOT_CREATED ? null : state.name,
      language:
        state.status === ReminderTemplateStatus.NOT_CREATED
          ? null
          : state.language,
      status: state.status,
      metaStatus: state.metaStatus,
    });
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
      // La plantilla vive en la WABA que se está soltando.
      lockedTenant.reminderTemplateName = null;
      lockedTenant.reminderTemplateLanguage = null;
      lockedTenant.reminderTemplateStatus = null;
      lockedTenant.reminderTemplateMetaStatus = null;

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
