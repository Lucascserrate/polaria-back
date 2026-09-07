import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { VerifiedCallback } from 'passport-jwt';

/** El nombre con el que se pide esta estrategia. Ver `CustomerAuthController`. */
export const CUSTOMER_GOOGLE_STRATEGY = 'customer-google';

/** Lo que sale de Google y entra a `findOrCreateByGoogle`. */
export interface CustomerGoogleProfile {
  googleId: string;
  email: string | null;
  name: string;
}

/**
 * La dirección a la que Google devuelve al cliente.
 *
 * Se **deriva** del callback del panel cambiándole el camino, y solo se usa
 * `GOOGLE_CUSTOMER_CALLBACK_URL` si alguien la define. Es para no agregar una
 * variable obligatoria: esta estrategia se construye al arrancar, así que una
 * variable nueva que falte en el despliegue tumbaría toda la API —incluidas las
 * reservas por WhatsApp— por una función que recién se estrena.
 *
 * Lo que **sí** hay que hacer a mano es registrar esta dirección como redirect
 * URI en la consola de Google. Eso no lo puede resolver el código.
 */
const customerCallbackUrl = (): string => {
  const explicit = process.env.GOOGLE_CUSTOMER_CALLBACK_URL?.trim();
  if (explicit) return explicit;

  const panelCallback = process.env.GOOGLE_CALLBACK_URL?.trim();
  if (!panelCallback) return '';

  try {
    const url = new URL(panelCallback);
    url.pathname = '/customer/auth/google/callback';
    return url.toString();
  } catch {
    return '';
  }
};

/**
 * El login con Google de **quien reserva**, separado del del panel.
 *
 * Es una estrategia propia y no un parámetro de la del negocio, y la diferencia
 * está en una sola línea: el `callbackURL`. Google devuelve al cliente a esta
 * dirección, y de ahí sale una cookie de cliente. Compartir el callback con el
 * panel obligaría a decidir dentro de él qué tipo de sesión emitir, con un dato
 * que viene del navegador; el día que ese dato se pudiera influir, un cliente
 * saldría con una sesión de negocio.
 *
 * Por eso hace falta registrar el URI nuevo en la consola de Google. Es el
 * precio de que los dos flujos no se toquen.
 */
@Injectable()
export class CustomerGoogleStrategy extends PassportStrategy(
  Strategy,
  CUSTOMER_GOOGLE_STRATEGY,
) {
  constructor() {
    const clientID = process.env.GOOGLE_CLIENT_ID ?? '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
    const callbackURL = customerCallbackUrl();

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error(
        'Faltan variables de Google: se usan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_CALLBACK_URL.',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      passReqToCallback: true,
      /*
       * Los mismos tres permisos que el panel, y ninguno más. En particular no
       * se pide nada de teléfono: Google no lo entrega de forma confiable, así
       * que el número se le pide a la persona una vez y se guarda en la cuenta.
       */
      scope: ['email', 'profile', 'openid'],
    });
  }

  validate(
    _req: unknown,
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifiedCallback,
  ) {
    const customer: CustomerGoogleProfile = {
      googleId: profile.id,
      email: profile.emails?.[0]?.value ?? null,
      // Google casi siempre manda `displayName`; si no, el correo es mejor que
      // dejar el nombre vacío y que el negocio reciba una reserva sin dueño.
      name: profile.displayName || (profile.emails?.[0]?.value ?? 'Cliente'),
    };

    done(null, customer);
  }
}
