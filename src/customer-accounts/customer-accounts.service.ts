import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerAccount } from './entities/customer-account.entity';
import { normalizeClientPhone } from '../clients/client-phone.util';

/** Lo que el sitio público necesita saber de la sesión. */
export interface CustomerAccountView {
  name: string;
  email: string | null;
  /** `null` mientras no lo dio. Sin esto no se puede reservar. */
  phone: string | null;
}

const toView = (account: CustomerAccount): CustomerAccountView => ({
  name: account.name,
  email: account.email,
  phone: account.phone,
});

@Injectable()
export class CustomerAccountsService {
  private readonly logger = new Logger(CustomerAccountsService.name);

  constructor(
    @InjectRepository(CustomerAccount)
    private readonly accounts: Repository<CustomerAccount>,
  ) {}

  findById(id: string): Promise<CustomerAccount | null> {
    return this.accounts.findOne({ where: { id } });
  }

  async viewOf(id: string): Promise<CustomerAccountView | null> {
    const account = await this.findById(id);
    return account ? toView(account) : null;
  }

  /**
   * La cuenta de quien acaba de volver de Google.
   *
   * Se busca por `googleId` y no por correo: el correo de una cuenta de Google
   * puede cambiar, el `sub` no. Buscar por correo haría que un cambio de correo
   * creara una cuenta nueva y la persona perdiera su teléfono y sus reservas.
   *
   * El nombre y el correo se **refrescan** en cada login. Es deliberado: son
   * datos de Google, no de Polaria, y quien se casó y se cambió el apellido
   * espera reservar con el nombre nuevo. El teléfono, en cambio, no se toca acá
   * nunca: ese sí lo escribió la persona.
   */
  async findOrCreateByGoogle(profile: {
    googleId: string;
    email: string | null;
    name: string;
  }): Promise<CustomerAccount> {
    const existing = await this.accounts.findOne({
      where: { googleId: profile.googleId },
    });

    if (existing) {
      const changed =
        existing.name !== profile.name || existing.email !== profile.email;

      if (changed) {
        await this.accounts.update(existing.id, {
          name: profile.name,
          email: profile.email,
        });
      }

      this.logger.log(
        `Sesión de cliente iniciada (accountId=${existing.id}, tienePhone=${Boolean(existing.phone)}).`,
      );

      return (await this.findById(existing.id)) ?? existing;
    }

    const created = await this.accounts.save(
      this.accounts.create({
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        phone: null,
      }),
    );

    this.logger.log(`Cuenta de cliente creada (accountId=${created.id}).`);

    return created;
  }

  /**
   * Guarda el teléfono de la cuenta, normalizado como lo guarda todo Polaria.
   *
   * `dialCode` es el prefijo del país del negocio donde la persona está
   * reservando, y se usa **solo** si el número parece local: quien escribe con
   * `+` manda su propio país. Es la misma regla que ya aplica el formulario
   * público, y sale de la misma función, así que un número escrito en la web y
   * el mismo número llegando por WhatsApp terminan idénticos.
   */
  async setPhone(
    accountId: string,
    rawPhone: string,
    dialCode: string,
  ): Promise<CustomerAccountView> {
    const phone = normalizeClientPhone(rawPhone, dialCode);

    if (!phone) {
      throw new BadRequestException(
        'Ese número no parece válido. Revisalo e intentá de nuevo.',
      );
    }

    await this.accounts.update(accountId, { phone });

    this.logger.log(`Teléfono guardado en la cuenta (accountId=${accountId}).`);

    const view = await this.viewOf(accountId);
    if (!view) {
      throw new BadRequestException('La cuenta no existe.');
    }

    return view;
  }
}
