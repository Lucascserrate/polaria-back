import { detectBookingTrigger } from './booking-trigger';

describe('detectBookingTrigger', () => {
  it('dispara ante un pedido claro de turno', () => {
    const messages = [
      'Quiero agendar un turno',
      'Hola, necesito una cita',
      'me gustaría reservar para el viernes',
      'Agéndame algo por favor',
      'Puedo sacar hora para mañana?',
      'TURNO PARA HOY?',
    ];

    for (const message of messages) {
      expect(detectBookingTrigger(message)).toBe(true);
    }
  });

  it('no dispara con preguntas sobre el negocio', () => {
    // El caso que motivó separar este disparador del pipeline viejo: su lista de
    // palabras incluía "horario" y "disponibilidad".
    const messages = [
      '¿Cuál es el horario de atención?',
      'Qué horarios tienen los sábados?',
      'Tienen disponibilidad los domingos?',
      'Cuánto sale el corte?',
      'Dónde están ubicados?',
      'Hacen decoloración?',
    ];

    for (const message of messages) {
      expect(detectBookingTrigger(message)).toBe(false);
    }
  });

  it('no dispara cuando el mensaje habla de una reserva existente', () => {
    // Contienen "turno" o "cita", pero abrir una reserva nueva sería lo contrario
    // de lo que el cliente pide.
    const messages = [
      'Quiero cancelar mi turno',
      'Necesito mover la cita de mañana',
      'Puedo cambiar mi turno para el sábado?',
      'quiero reprogramar el turno',
      'anular la cita por favor',
    ];

    for (const message of messages) {
      expect(detectBookingTrigger(message)).toBe(false);
    }
  });

  it('no dispara con saludos ni mensajes vacíos', () => {
    for (const message of ['Hola', 'buenas tardes', '', '   ', '👋']) {
      expect(detectBookingTrigger(message)).toBe(false);
    }
  });

  it('tolera acentos y puntuación', () => {
    expect(detectBookingTrigger('¿Puedo reservar?')).toBe(true);
    expect(detectBookingTrigger('quiero un TURNO!!!')).toBe(true);
  });
});
