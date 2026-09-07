import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerAccount } from './entities/customer-account.entity';
import { CustomerAccountsService } from './customer-accounts.service';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerGoogleStrategy } from './customer-google.strategy';
import { CustomerGuard, CustomerSessionService } from './customer-session';

/**
 * Las cuentas de quienes reservan, y su sesión.
 *
 * `JwtModule.register({})` sin secreto no es un olvido: el de esta sesión se
 * deriva y se pasa en cada firma y en cada verificación, justamente para no
 * heredar el del panel. Ver `customer-session.ts`.
 *
 * Se exportan el servicio y la sesión porque la reserva pública los necesita:
 * cuando hay sesión, el nombre y el teléfono salen de la cuenta y no de lo que
 * mande el navegador.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerAccount]),
    JwtModule.register({}),
  ],
  controllers: [CustomerAuthController],
  providers: [
    CustomerAccountsService,
    CustomerSessionService,
    CustomerGuard,
    CustomerGoogleStrategy,
  ],
  exports: [CustomerAccountsService, CustomerSessionService],
})
export class CustomerAccountsModule {}
