import {
  BILLING_ERROR_CODES,
  buildBillingSetupUrl,
  isBillingError,
  normalizeBillingCurrency,
  WhatsappBillingStatus,
} from './billing-status';

describe('isBillingError', () => {
  /*
   * El caso real: Meta aceptó el envío, devolvió un `wamid`, y siete segundos después
   * avisó por webhook que el mensaje no iba a salir.
   */
  it('reconoce el 131042 que vimos en producción', () => {
    expect(
      isBillingError([
        {
          code: 131042,
          detail:
            'Message failed to send because your WhatsApp Business account currency is not configured.',
        },
      ]),
    ).not.toBeNull();
  });

  /*
   * Lo que protege este test es que no marquemos la facturación como rota por un
   * error que no habla de facturación. Un negocio mandado al Billing Hub a buscar un
   * problema inexistente es peor que no avisarle nada.
   */
  it('ignora los errores que no son de facturación', () => {
    expect(
      isBillingError([{ code: 131026, detail: 'undeliverable' }]),
    ).toBeNull();
    expect(isBillingError([{ code: 470, detail: 'template' }])).toBeNull();
    expect(isBillingError([])).toBeNull();
    expect(isBillingError([{ code: null, detail: 'sin código' }])).toBeNull();
  });

  it('encuentra el de facturación aunque venga acompañado', () => {
    expect(
      isBillingError([
        { code: 131026, detail: 'otro' },
        { code: 131042, detail: 'moneda' },
      ])?.code,
    ).toBe(131042);
  });

  /*
   * La lista tiene un solo código a propósito: es el único con evidencia. Este test
   * está para que agregar otro sea una decisión y no un descuido.
   */
  it('solo hay un código con evidencia', () => {
    expect([...BILLING_ERROR_CODES]).toEqual([131042]);
  });
});

describe('WhatsappBillingStatus', () => {
  /*
   * Hubo un `READY` y se quitó: lo ponía una sonda que solo lee la moneda, que es una
   * de las causas del `131042` y no la única. Este test está para que reponerlo sea
   * una decisión discutida y no un agregado al pasar.
   */
  it('no existe un estado que afirme que el negocio puede enviar', () => {
    expect(Object.values(WhatsappBillingStatus)).toEqual([
      'UNKNOWN',
      'ACTION_REQUIRED',
    ]);
  });
});

describe('buildBillingSetupUrl', () => {
  it('lleva a la cuenta de facturación de esa WABA', () => {
    const url = buildBillingSetupUrl({
      businessId: '988356437562551',
      wabaId: '1557192815771344',
    });

    expect(url).toBe(
      'https://business.facebook.com/billing_hub/accounts/details/' +
        '?business_id=988356437562551&asset_id=1557192815771344' +
        '&account_type=whatsapp-business-account',
    );
  });

  /*
   * Llevaba `wizard_name=CHANGE_COUNTRY_CURRENCY` fijo. `131042` cubre varias causas,
   * así que a un negocio con la tarjeta rechazada lo mandaba al asistente equivocado
   * —y ese asistente suele estar bloqueado en cuentas que ya gastaron—. Sin el
   * parámetro, Meta muestra lo que realmente falte.
   */
  it('no fuerza un asistente que puede no ser el que hace falta', () => {
    expect(
      buildBillingSetupUrl({ businessId: '1', wabaId: '2' }),
    ).not.toContain('wizard_name');
  });

  /*
   * Sin los ids, un enlace al Business Manager genérico deja al negocio buscando
   * dónde. Mejor no ofrecer botón.
   */
  it('sin los ids no hay enlace', () => {
    expect(buildBillingSetupUrl({ businessId: null, wabaId: '1' })).toBeNull();
    expect(buildBillingSetupUrl({ businessId: '1', wabaId: null })).toBeNull();
    expect(buildBillingSetupUrl({ businessId: '  ', wabaId: '1' })).toBeNull();
  });

  /*
   * Estas columnas guardan a veces las cadenas `'null'` y `'undefined'` —por eso
   * existe `readStoredCredential`—, y sobreviven a un chequeo de vacío. Sin filtrarlas
   * el botón quedaba activo y llevaba a `business_id=null`: una página rota, que es
   * peor que no ofrecer botón.
   */
  it('descarta las cadenas basura que estas columnas llegan a guardar', () => {
    expect(
      buildBillingSetupUrl({ businessId: 'null', wabaId: '1' }),
    ).toBeNull();
    expect(
      buildBillingSetupUrl({ businessId: '1', wabaId: 'undefined' }),
    ).toBeNull();
  });
});

describe('normalizeBillingCurrency', () => {
  it('conserva la moneda que Meta declara', () => {
    expect(normalizeBillingCurrency('BOB')).toBe('BOB');
  });

  /*
   * Que no haya moneda **no** es un problema de facturación: puede faltar porque el
   * token no tiene permiso de leer el campo. Por eso esto devuelve un dato y no un
   * estado — antes devolvía un estado, y de ahí salía el falso verde.
   */
  it('la ausencia es un dato faltante, no un veredicto', () => {
    expect(normalizeBillingCurrency(null)).toBeNull();
    expect(normalizeBillingCurrency(undefined)).toBeNull();
    expect(normalizeBillingCurrency('   ')).toBeNull();
  });
});
