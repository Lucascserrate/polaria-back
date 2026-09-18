import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TenantsModule } from '../tenants/tenants.module';
import { StaffModule } from '../staff/staff.module';
import { RolesGuard } from './guards/roles.guard';
import { SignupController } from './signup/signup.controller';
import { SignupGuard } from './signup/signup.guard';

const jwtSecret = process.env.SECRET_JWT ?? '';

@Module({
  imports: [
    PassportModule,
    TenantsModule,
    StaffModule,
    JwtModule.register({
      global: true,
      secret: jwtSecret,
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [AuthController, SignupController],
  providers: [
    AuthService,
    GoogleStrategy,
    JwtStrategy,
    RolesGuard,
    SignupGuard,
  ],
  /*
   * `SignupGuard` se exporta porque lo monta otro módulo: los pedidos de acceso
   * son parte del alta, pero viven con su propia tabla. Sin exportarlo, Nest no
   * puede resolverlo donde se usa y eso falla al arrancar, no al compilar.
   */
  exports: [AuthService, RolesGuard, SignupGuard],
})
export class AuthModule {}
