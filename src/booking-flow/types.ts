export type BookingStep =
  | 'inicio'
  | 'seleccionar_servicio'
  | 'seleccionar_peluquero'
  | 'seleccionar_fecha'
  | 'seleccionar_hora'
  | 'confirmar'
  | 'completado';

export type BookingEventType = 'boton' | 'lista' | 'texto';

export type BookingEvent = {
  telefono: string;
  tipo: BookingEventType;
  valor: string;
  messageId?: string;
  tenantId?: string;
  clientName?: string;
};

export type BookingContextData = {
  servicio_id?: string;
  peluquero_id?: string;
  fecha?: string;
  hora?: string;
  appointment_id?: string;
};

export type BookingAction =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'buttons';
      text: string;
      buttons: Array<{ id: string; title: string }>;
    }
  | {
      kind: 'list';
      text: string;
      buttonText: string;
      sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    }
  | {
      kind: 'handoff_ai';
      text?: string;
    };
