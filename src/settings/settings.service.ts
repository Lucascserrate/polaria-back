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

type SettingsResponse = {
  polariaName: string;
  /**
   * Horario semanal del negocio, una entrada por franja. Un día sin entradas
   * está cerrado; varias entradas en un mismo día son un turno partido.
   */
  businessHours: WeeklyScheduleRange[];
  aiEnabled: boolean;
  whatsappConnection: {
    connected: boolean;
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
  ) {}

  async getSettings(tenantId: string): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.logger.log(
      `Loading settings tenantId=${tenantId} tenantName=${tenant.name} hasWhatsappToken=${Boolean(readStoredCredential(tenant.whatsappAccessToken))} hasPhoneId=${Boolean(tenant.whatsappPhoneId)} hasWabaId=${Boolean(tenant.whatsappWabaId)}`,
    );

    const businessHours =
      await this.businessHoursService.getTenantSchedule(tenantId);

    return {
      polariaName: tenant.name,
      businessHours,
      aiEnabled: tenant.aiEnabled,
      whatsappConnection: {
        connected: Boolean(
          readStoredCredential(tenant.whatsappAccessToken) &&
          readStoredCredential(tenant.whatsappPhoneId) &&
          readStoredCredential(tenant.whatsappWabaId),
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

    if (
      typeof dto.aiEnabled === 'boolean' &&
      dto.aiEnabled !== tenant.aiEnabled
    ) {
      await this.tenantsService.update(tenantId, {
        aiEnabled: dto.aiEnabled,
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
          whatsappConnection.businessId ?? tenant.whatsappBusinessId,
        whatsappWabaId: whatsappConnection.wabaId ?? tenant.whatsappWabaId,
        whatsappPhoneId:
          whatsappConnection.phoneNumberId ?? tenant.whatsappPhoneId,
        whatsappPhoneNumber:
          whatsappConnection.phoneNumber ?? tenant.whatsappPhoneNumber,
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
      await this.businessHoursService.replaceTenantSchedule(
        tenantId,
        dto.businessHours,
      );
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
        lockedTenant.whatsappFlowId = undefined;
      }

      lockedTenant.whatsappBusinessId = discoveredBusinessId;
      lockedTenant.whatsappWabaId = discoveredWabaId;
      lockedTenant.whatsappPhoneId = discoveredPhoneNumberId;
      lockedTenant.whatsappPhoneNumber = discoveredPhoneNumber;
      lockedTenant.whatsappVerifiedName = discoveredVerifiedName ?? undefined;
      lockedTenant.whatsappIsOnBusinessApp = isOnBusinessApp;
      lockedTenant.whatsappPlatformType = discoveredPlatformType ?? undefined;
      lockedTenant.whatsappAccessToken = systemUserAccessToken;
      lockedTenant.whatsappConnectedAt = new Date();

      const savedTenant = await tenantRepository.save(lockedTenant);
      this.logger.log(`Embedded signup tenant updated tenantId=${tenantId}`);

      return savedTenant;
    });

    if (!updatedTenant) {
      throw new NotFoundException('Tenant not found');
    }

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
