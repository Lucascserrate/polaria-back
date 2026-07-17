import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessHoursService } from '../business_hours/business_hours.service';
import { TenantsService } from '../tenants/tenants.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Logger } from '@nestjs/common';
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
  workingDays: boolean[];
  openingHours: { from: string; to: string } | null;
  aiEnabled: boolean;
  whatsappConnection: {
    connected: boolean;
    businessId: string | null;
    wabaId: string | null;
    phoneNumberId: string | null;
    phoneNumber: string | null;
    verifiedName: string | null;
    connectedAt: string | null;
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
      `Loading settings tenantId=${tenantId} tenantName=${tenant.name} hasWhatsappToken=${Boolean(tenant.whatsappSystemUserAccessToken)} hasPhoneId=${Boolean(tenant.whatsappPhoneId)} hasWabaId=${Boolean(tenant.whatsappWabaId)}`,
    );

    const { workingDays, openingHours } =
      await this.businessHoursService.getTenantHoursSettings(tenantId);

    return {
      polariaName: tenant.name,
      workingDays,
      openingHours,
      aiEnabled: tenant.aiEnabled,
      whatsappConnection: {
        connected: Boolean(
          tenant.whatsappSystemUserAccessToken &&
          tenant.whatsappPhoneId &&
          tenant.whatsappWabaId,
        ),
        businessId: tenant.whatsappBusinessId ?? null,
        wabaId: tenant.whatsappWabaId ?? null,
        phoneNumberId: tenant.whatsappPhoneId ?? null,
        phoneNumber: tenant.whatsappPhoneNumber ?? null,
        verifiedName: tenant.whatsappVerifiedName ?? null,
        connectedAt: tenant.whatsappConnectedAt
          ? tenant.whatsappConnectedAt.toISOString()
          : null,
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
      `Updating settings tenantId=${tenantId} hasPolariaName=${Boolean(dto.polariaName)} hasAiEnabled=${typeof dto.aiEnabled === 'boolean'} hasWorkingDays=${Boolean(dto.workingDays)} hasOpeningHours=${Boolean(dto.openingHours)}`,
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

      const updatedTenant = await this.tenantsService.update(tenantId, {
        whatsappBusinessId:
          whatsappConnection.businessId ?? tenant.whatsappBusinessId,
        whatsappWabaId: whatsappConnection.wabaId ?? tenant.whatsappWabaId,
        whatsappPhoneId:
          whatsappConnection.phoneNumberId ?? tenant.whatsappPhoneId,
        whatsappPhoneNumber:
          whatsappConnection.phoneNumber ?? tenant.whatsappPhoneNumber,
        whatsappSystemUserAccessToken:
          whatsappConnection.systemUserAccessToken ??
          tenant.whatsappSystemUserAccessToken,
        whatsappAccessToken:
          whatsappConnection.systemUserAccessToken ??
          tenant.whatsappAccessToken,
      });

      if (!updatedTenant) {
        throw new NotFoundException('Tenant not found');
      }
    }

    await this.businessHoursService.updateTenantHoursSettings(tenantId, {
      workingDays: dto.workingDays,
      openingHours: dto.openingHours,
    });

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
    },
  ): Promise<SettingsResponse> {
    const tenant = await this.tenantsService.findOne(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.logger.log(
      `Starting embedded signup exchange tenantId=${tenantId} hasCode=${Boolean(payload.code)} payloadBusinessId=${payload.businessId ?? 'null'} payloadWabaId=${payload.wabaId ?? 'null'} payloadPhoneNumberId=${payload.phoneNumberId ?? 'null'} payloadPhoneNumber=${payload.phoneNumber ?? 'null'}`,
    );

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

    this.logger.log(
      `[Embedded signup] exchanging code ${payload.code.substring(0, 20)}...`,
    );
    this.logger.log(
      `[Embedded signup] params ${JSON.stringify({
        client_id: appId,
        has_client_secret: !!appSecret,
      })}`,
    );

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

      this.logger.debug(
        '[Embedded signup] OAuth token response',
        JSON.stringify(response.data),
      );
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
          normalizedErrorMessage.includes('already')
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
      payload.systemUserAccessToken ?? tokenData.access_token;

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

    type PhoneNumberNode = {
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
    };
    type OwnedWabaNode = {
      id?: string;
      name?: string;
      phone_numbers?: PhoneNumberNode[];
    };
    type OwnedWabasResponse = { data?: OwnedWabaNode[] };

    const ownedWabas = await graphGet<OwnedWabasResponse>(
      '/me/whatsapp_business_accounts?fields=id,name',
      systemUserAccessToken,
    );
    this.logger.debug(
      '[Embedded signup] /me/owned_whatsapp_business_accounts response',
      JSON.stringify(ownedWabas),
    );

    this.logger.log(`Embedded signup Graph data obtained tenantId=${tenantId}`);

    const discoveredBusinessId = payload.businessId ?? null;
    const discoveredWabaId = payload.wabaId ?? ownedWabas.data?.[0]?.id ?? null;
    if (!discoveredWabaId) {
      throw new BadRequestException(
        'Meta did not return a WhatsApp Business Account (WABA)',
      );
    }
    const wabaPhoneNumbers = await graphGet<{ data?: PhoneNumberNode[] }>(
      `/${discoveredWabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
      systemUserAccessToken,
    );
    this.logger.debug(
      '[Embedded signup] /phone_numbers response',
      JSON.stringify(wabaPhoneNumbers),
    );
    const discoveredPhoneNumberId =
      payload.phoneNumberId ?? wabaPhoneNumbers.data?.[0]?.id ?? null;
    const discoveredPhoneNumber =
      wabaPhoneNumbers.data?.[0]?.display_phone_number ?? null;
    const discoveredVerifiedName =
      wabaPhoneNumbers.data?.[0]?.verified_name ?? null;

    this.logger.debug(
      '[Embedded signup] discovered identifiers',
      JSON.stringify({
        discoveredBusinessId,
        discoveredWabaId,
        discoveredPhoneNumberId,
        discoveredPhoneNumber,
        discoveredVerifiedName,
      }),
    );

    if (
      !discoveredBusinessId ||
      !discoveredWabaId ||
      !discoveredPhoneNumberId ||
      !discoveredPhoneNumber
    ) {
      throw new BadRequestException(
        'Meta did not return the expected business, WABA, or phone number data',
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

      lockedTenant.whatsappBusinessId = discoveredBusinessId;
      lockedTenant.whatsappWabaId = discoveredWabaId;
      lockedTenant.whatsappPhoneId = discoveredPhoneNumberId;
      lockedTenant.whatsappPhoneNumber = discoveredPhoneNumber;
      lockedTenant.whatsappVerifiedName = discoveredVerifiedName ?? undefined;
      lockedTenant.whatsappSystemUserAccessToken = systemUserAccessToken;
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
}
