import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessHoursService } from '../business_hours/business_hours.service';
import { TenantsService } from '../tenants/tenants.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

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

    const appId =
      this.configService.get<string>('META_APP_ID') ??
      this.configService.get<string>('FACEBOOK_APP_ID');
    const appSecret =
      this.configService.get<string>('META_APP_SECRET') ??
      this.configService.get<string>('FACEBOOK_APP_SECRET');
    const graphVersion =
      this.configService.get<string>('META_GRAPH_VERSION') ??
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ??
      'v21.0';
    const redirectUri =
      this.configService.get<string>('META_REDIRECT_URI') ??
      this.configService.get<string>('FACEBOOK_CALLBACK_URL') ??
      this.configService.get<string>('PUBLIC_BASE_URL');

    if (!appId || !appSecret) {
      throw new NotFoundException('Meta app credentials are not configured');
    }
    if (!redirectUri) {
      throw new NotFoundException('Meta redirect URI is not configured');
    }

    this.logger.log(
      `Embedded signup OAuth exchange prepared tenantId=${tenantId} graphVersion=${graphVersion} redirectUri=${redirectUri} appIdSuffix=${appId.slice(-6)}`,
    );

    const tokenEndpoint = `https://graph.facebook.com/${graphVersion}/oauth/access_token`;
    const tokenParams = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code: payload.code,
      grant_type: 'authorization_code',
    });

    this.logger.log(
      `Embedded signup OAuth exchange request tenantId=${tenantId} endpoint=${tokenEndpoint} client_id=${appId} redirect_uri=${redirectUri} grant_type=authorization_code codeLength=${payload.code.length}`,
    );

    const tokenResponse = await fetch(
      `${tokenEndpoint}?${tokenParams.toString()}`,
      {
        method: 'GET',
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: { message?: string };
    };

    this.logger.log(
      `Embedded signup OAuth exchange response tenantId=${tenantId} ok=${tokenResponse.ok} status=${tokenResponse.status} hasAccessToken=${Boolean(tokenData.access_token)} tokenType=${tokenData.token_type ?? 'null'} expiresIn=${tokenData.expires_in ?? 'null'}`,
    );

    if (!tokenResponse.ok || !tokenData.access_token) {
      this.logger.error(
        `Embedded signup token exchange failed tenantId=${tenantId} status=${tokenResponse.status} body=${JSON.stringify(tokenData)}`,
      );
      throw new NotFoundException(
        tokenData.error?.message ??
          'Unable to exchange the Embedded Signup authorization code',
      );
    }

    const systemUserAccessToken =
      payload.systemUserAccessToken ?? tokenData.access_token;

    this.logger.log(
      `Embedded signup token exchange OK tenantId=${tenantId} tokenType=${tokenData.token_type ?? 'unknown'} expiresIn=${tokenData.expires_in ?? 'unknown'}`,
    );

    const graphBaseUrl = `https://graph.facebook.com/${graphVersion}`;
    const graphGet = async <T>(path: string, accessToken: string) => {
      this.logger.log(
        `Embedded signup Graph request tenantId=${tenantId} path=${path}`,
      );
      const response = await fetch(`${graphBaseUrl}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = (await response.json()) as T & {
        error?: { message?: string; type?: string; code?: number };
      };

      this.logger.log(
        `Embedded signup Graph response tenantId=${tenantId} path=${path} ok=${response.ok} status=${response.status}`,
      );

      if (!response.ok) {
        throw new BadRequestException(
          data.error?.message ?? `Graph API request failed for ${path}`,
        );
      }

      return data;
    };

    type BusinessNode = { id?: string; name?: string };
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
    type MeBusinessesResponse = { data?: BusinessNode[] };
    type OwnedWabasResponse = { data?: OwnedWabaNode[] };

    const meBusinesses = await graphGet<MeBusinessesResponse>(
      '/me/businesses?fields=id,name',
      systemUserAccessToken,
    );
    const ownedWabas = await graphGet<OwnedWabasResponse>(
      '/me/owned_whatsapp_business_accounts?fields=id,name',
      systemUserAccessToken,
    );

    this.logger.log(
      `Embedded signup graph lookup tenantId=${tenantId} businessesCount=${meBusinesses?.data?.length ?? 0} wabasCount=${ownedWabas?.data?.length ?? 0}`,
    );

    const discoveredBusinessId =
      payload.businessId ?? meBusinesses.data?.[0]?.id ?? null;
    const discoveredWabaId = payload.wabaId ?? ownedWabas.data?.[0]?.id ?? null;
    const wabaPhoneNumbers = await graphGet<{ data?: PhoneNumberNode[] }>(
      `/${encodeURIComponent(discoveredWabaId!)}/phone_numbers?fields=id,display_phone_number,verified_name`,
      systemUserAccessToken,
    );
    const discoveredPhoneNumberId =
      payload.phoneNumberId ?? wabaPhoneNumbers.data?.[0]?.id ?? null;
    const discoveredPhoneNumber =
      wabaPhoneNumbers.data?.[0]?.display_phone_number ?? null;
    const discoveredVerifiedName =
      wabaPhoneNumbers.data?.[0]?.verified_name ?? null;

    if (
      !discoveredBusinessId ||
      !discoveredWabaId ||
      !discoveredPhoneNumberId ||
      !discoveredPhoneNumber
    ) {
      this.logger.error(
        `Embedded signup Graph data incomplete tenantId=${tenantId} businessId=${discoveredBusinessId ?? 'null'} wabaId=${discoveredWabaId ?? 'null'} phoneNumberId=${discoveredPhoneNumberId ?? 'null'} phoneNumber=${discoveredPhoneNumber ?? 'null'} verifiedName=${discoveredVerifiedName ?? 'null'}`,
      );
      throw new BadRequestException(
        'Meta did not return the expected business, WABA, or phone number data',
      );
    }

    this.logger.log(
      `Embedded signup normalized Graph data tenantId=${tenantId} businessId=${discoveredBusinessId} wabaId=${discoveredWabaId} phoneNumberId=${discoveredPhoneNumberId} phoneNumber=${discoveredPhoneNumber} verifiedName=${discoveredVerifiedName ?? 'null'}`,
    );

    const updatedTenant = await this.dataSource.transaction(async (manager) => {
      const tenantRepository = manager.getRepository(Tenant);

      this.logger.log(
        `Embedded signup transaction started tenantId=${tenantId}`,
      );

      const lockedTenant = await tenantRepository.findOne({
        where: { id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!lockedTenant) {
        this.logger.error(
          `Embedded signup transaction tenant missing tenantId=${tenantId}`,
        );
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
        this.logger.error(
          `Embedded signup phone collision detected tenantId=${tenantId} conflictingTenantId=${tenantWithSamePhone.id} phoneNumberId=${discoveredPhoneNumberId}`,
        );
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
        this.logger.error(
          `Embedded signup WABA collision detected tenantId=${tenantId} conflictingTenantId=${tenantWithSameWaba.id} wabaId=${discoveredWabaId}`,
        );
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

      this.logger.log(
        `Embedded signup saving tenant tenantId=${tenantId} businessId=${lockedTenant.whatsappBusinessId} wabaId=${lockedTenant.whatsappWabaId} phoneNumberId=${lockedTenant.whatsappPhoneId} phoneNumber=${lockedTenant.whatsappPhoneNumber} verifiedName=${lockedTenant.whatsappVerifiedName ?? 'null'}`,
      );

      const savedTenant = await tenantRepository.save(lockedTenant);
      this.logger.log(
        `Embedded signup tenant persisted tenantId=${tenantId} savedBusinessId=${savedTenant.whatsappBusinessId ?? 'null'} savedWabaId=${savedTenant.whatsappWabaId ?? 'null'} savedPhoneNumberId=${savedTenant.whatsappPhoneId ?? 'null'} savedPhoneNumber=${savedTenant.whatsappPhoneNumber ?? 'null'} savedVerifiedName=${savedTenant.whatsappVerifiedName ?? 'null'} savedConnectedAt=${savedTenant.whatsappConnectedAt?.toISOString() ?? 'null'}`,
      );

      return savedTenant;
    });

    this.logger.log(
      `Embedded signup tenant updated tenantId=${tenantId} businessId=${discoveredBusinessId ?? 'null'} wabaId=${discoveredWabaId ?? 'null'} phoneNumberId=${discoveredPhoneNumberId ?? 'null'} phoneNumber=${discoveredPhoneNumber ?? 'null'}`,
    );

    if (!updatedTenant) {
      throw new NotFoundException('Tenant not found');
    }

    return this.getSettings(tenantId);
  }
}
