import { QUOTED_PRICE_LABEL } from '../../services/quoted-price';

export const buildServicesPromptAddon = (params: {
  services: string[];
  servicesCatalog: Array<{
    name: string;
    /** `null` si se cotiza después de ver a la persona. */
    price: number | null;
    durationMinutes: number;
    description?: string;
  }>;
  businessName: string;
}) => {
  const { services, servicesCatalog, businessName } = params;

  const servicesCatalogText = servicesCatalog.length
    ? servicesCatalog
        .slice(0, 30)
        .map((s) => {
          /*
           * Sin precio se escribe el aviso y no un cero: `Number.isFinite(null)`
           * es falso y el cero de antes le decía al modelo que el servicio era
           * gratis, que es exactamente lo que después repetía al cliente.
           */
          const price =
            s.price !== null && Number.isFinite(s.price)
              ? `$${s.price}`
              : QUOTED_PRICE_LABEL;
          return `- ${s.name} — ${price} — ${s.durationMinutes} min`;
        })
        .join('\n')
    : '';

  const serviceList = services.length
    ? services
        .slice(0, 12)
        .map((s) => `• ${s}`)
        .join('\n')
    : '• Los servicios disponibles en la barbería';

  return `
INTENCIÓN DETECTADA: ASK_SERVICES

El usuario pregunta por los servicios de la barbería.

OBJETIVO:
- Mencionar SOLO servicios reales del contexto
- Ser natural y breve
- Mostrar los servicios en lista vertical (uno debajo del otro)
- Invitar a agendar con una pregunta concreta (servicio o día)
- No inventar servicios

REGLAS ESPECIALES (precio/duración):
- Si el usuario pregunta "cuánto vale" / "precio" / "cuánto cuesta" un servicio: responde con su precio y duración reales.
- Si pregunta por el precio de UN servicio específico: responde SOLO ese servicio (precio + duración) y luego pregunta si desea agendar; NO enumeres todos los servicios a menos que el usuario lo pida.
- Si pregunta por el "más barato" o el "más caro": responde con el servicio correspondiente y su precio/duración.
- Si un servicio figura como "${QUOTED_PRICE_LABEL}": NO tiene precio y NO debes inventar uno ni estimarlo. Explicá que ese servicio se cotiza después de una consulta previa y ofrecé coordinarla.
- Si pregunta por "mejor calidad": no inventes. Puedes sugerir el más completo por duración/precio o preguntar qué busca, usando solo el catálogo real.

Contexto:
- Barbería: ${businessName}
- Servicios reales (lista):
${serviceList}

- Catálogo con precios y duración (si aplica):
${servicesCatalogText || '- (no disponible)'}

Formato de salida obligatorio:
{
  "reply": "string"
}
`.trim();
};
