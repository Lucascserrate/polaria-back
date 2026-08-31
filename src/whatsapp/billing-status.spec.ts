import {
  BILLING_ERROR_CODES,
  blocksNotifications,
  buildBillingSetupUrl,
  isBillingError,
  normalizeBillingCurrency,
  readHealthVerdict,
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
   * de las causas del `131042` y no la única. Este test está para que reponer un
   * estado que afirme "puede enviar" sea una decisión discutida y no un agregado al
   * pasar — hoy eso no lo sabemos, solo lo sabe Meta al enviar.
   */
  it('ningún estado afirma que el negocio puede enviar', () => {
    expect(Object.values(WhatsappBillingStatus)).toEqual([
      'PENDING_SETUP',
      'UNKNOWN',
      'ACTION_REQUIRED',
    ]);
  });

  /*
   * Bloquean los dos por los que Meta tiene algo que decir: el paso que exige a todo
   * cliente de un Tech Provider, y el rechazo concreto. `UNKNOWN` es nuestra
   * ignorancia, y trabar a un negocio por eso sería trabajar en contra suyo.
   */
  it('solo bloquea lo que viene de Meta, no nuestra ignorancia', () => {
    expect(blocksNotifications('PENDING_SETUP')).toBe(true);
    expect(blocksNotifications('ACTION_REQUIRED')).toBe(true);
    expect(blocksNotifications('UNKNOWN')).toBe(false);
  });
});

describe('readHealthVerdict', () => {
  /*
   * `health_status` es la pregunta correcta y llegamos tarde a ella: contesta
   * literalmente `can_send_message`, mientras que la sonda anterior miraba `currency`,
   * que cubre una sola de las causas de bloqueo.
   */
  it('bloquea cuando Meta dice BLOCKED, con su explicación y su solución', () => {
    expect(
      readHealthVerdict({
        can_send_message: 'BLOCKED',
        entities: [
          {
            entity_type: 'WABA',
            id: '1',
            can_send_message: 'BLOCKED',
            errors: [
              {
                error_code: 131042,
                error_description: 'Business eligibility payment issue.',
                possible_solution: 'Add a payment method to your account.',
              },
            ],
          },
        ],
      }),
    ).toEqual({
      blocked: true,
      reason:
        'Business eligibility payment issue. Add a payment method to your account.',
    });
  });

  /*
   * `AVAILABLE` **no** desbloquea, y por eso este test comprueba `blocked: false` y no
   * un permiso: Meta no documenta que el problema de facturación se refleje acá, así
   * que tomarlo como confirmación repetiría el falso verde que ya tuvimos.
   */
  it('sin un BLOCKED explícito no hay bloqueo, pero tampoco permiso', () => {
    expect(readHealthVerdict({ can_send_message: 'AVAILABLE' })).toEqual({
      blocked: false,
      reason: null,
    });
    expect(readHealthVerdict(null)).toEqual({ blocked: false, reason: null });
    expect(readHealthVerdict({})).toEqual({ blocked: false, reason: null });
  });

  /* `LIMITED` es "puede enviar con restricciones": no es un bloqueo. */
  it('LIMITED no bloquea', () => {
    expect(
      readHealthVerdict({
        can_send_message: 'LIMITED',
        entities: [
          { entity_type: 'PHONE_NUMBER', id: '1', can_send_message: 'LIMITED' },
        ],
      }).blocked,
    ).toBe(false);
  });

  /*
   * El bloqueo puede venir en una entidad aunque el resumen de arriba no lo diga, y al
   * revés. Se mira lo que haya: perderse un `BLOCKED` es dejar al negocio enviando
   * mensajes que no van a salir.
   */
  it('encuentra el bloqueo aunque solo lo declare una entidad', () => {
    expect(
      readHealthVerdict({
        can_send_message: 'AVAILABLE',
        entities: [
          { entity_type: 'APP', id: '1', can_send_message: 'AVAILABLE' },
          {
            entity_type: 'BUSINESS',
            id: '2',
            can_send_message: 'BLOCKED',
            errors: [{ error_code: 1, error_description: 'Not verified' }],
          },
        ],
      }),
    ).toEqual({ blocked: true, reason: 'Not verified' });
  });

  /* Un bloqueo sin texto sigue siendo un bloqueo: la UI dirá lo que pueda. */
  it('bloquea aunque Meta no explique por qué', () => {
    expect(
      readHealthVerdict({
        can_send_message: 'BLOCKED',
        entities: [
          { entity_type: 'WABA', id: '1', can_send_message: 'BLOCKED' },
        ],
      }),
    ).toEqual({ blocked: true, reason: null });
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
