import { JwtService } from '@nestjs/jwt';
import { Tenant } from '../../tenants/entities/tenant.entity';

const jwtSecret = process.env.SECRET_JWT ?? '';

export const createJwtToken = (tenant: Tenant, jwtService: JwtService) => {
  const payload = {
    sub: tenant.id,
    email: tenant.email ?? null,
  };

  return {
    accessToken: jwtService.sign(payload),
    refreshToken: jwtService.sign(payload, {
      expiresIn: '7d',
      secret: jwtSecret,
    }),
  };
};
