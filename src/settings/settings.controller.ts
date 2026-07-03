import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  getSettings(@Req() req: Request) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.settingsService.getSettings(tenantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch()
  updateSettings(
    @Req() req: Request,
    @Body() updateSettingsDto: UpdateSettingsDto,
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return this.settingsService.updateSettings(tenantId, updateSettingsDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('whatsapp/embedded-signup')
  completeWhatsappEmbeddedSignup(
    @Req() req: Request,
    @Body()
    body: {
      code?: string;
      businessId?: string;
      wabaId?: string;
      phoneNumberId?: string;
      phoneNumber?: string;
      systemUserAccessToken?: string;
    },
  ) {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    if (!body.code) {
      throw new UnauthorizedException('Missing authorization code');
    }

    this.logger.log(
      `Embedded signup request received tenantId=${tenantId} hasCode=${Boolean(body.code)} codeLength=${body.code.length} businessId=${body.businessId ?? 'null'} wabaId=${body.wabaId ?? 'null'} phoneNumberId=${body.phoneNumberId ?? 'null'} phoneNumber=${body.phoneNumber ?? 'null'}`,
    );

    return this.settingsService
      .completeWhatsappEmbeddedSignup(tenantId, {
        code: body.code,
        businessId: body.businessId,
        wabaId: body.wabaId,
        phoneNumberId: body.phoneNumberId,
        phoneNumber: body.phoneNumber,
        systemUserAccessToken: body.systemUserAccessToken,
      })
      .then((result) => {
        this.logger.log(
          `Embedded signup completed tenantId=${tenantId} connected=${result.whatsappConnection.connected} businessId=${result.whatsappConnection.businessId ?? 'null'} wabaId=${result.whatsappConnection.wabaId ?? 'null'} phoneNumberId=${result.whatsappConnection.phoneNumberId ?? 'null'} phoneNumber=${result.whatsappConnection.phoneNumber ?? 'null'} verifiedName=${result.whatsappConnection.verifiedName ?? 'null'}`,
        );
        return result;
      })
      .catch((error) => {
        this.logger.error(
          `Embedded signup failed tenantId=${tenantId} message=${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        throw error;
      });
  }
}
