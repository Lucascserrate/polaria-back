import { readFileSync } from 'fs';
import { join } from 'path';

import { FLOW_TRIGGERS } from './flow-endpoint.service';
import { FLOW_DATA_API_VERSION, FLOW_SCREENS } from './flow-screen';

/**
 * El Flow JSON es un artefacto que se publica en Meta, no código que compile, así
 * que nada garantiza que siga en línea con el endpoint salvo estas comprobaciones.
 * Cubren los desajustes que el validador de Meta **no** detecta.
 */
const flow = JSON.parse(
  readFileSync(join(__dirname, 'booking-flow.json'), 'utf-8'),
) as {
  version: string;
  data_api_version: string;
  routing_model: Record<string, string[]>;
  screens: Array<{
    id: string;
    terminal?: boolean;
    data?: Record<string, unknown>;
    layout: unknown;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type FlowAction = {
  name?: string;
  next?: { name?: string };
  payload?: Record<string, unknown>;
};

/** Recorre el árbol de layout juntando todas las acciones declaradas. */
function collectActions(node: unknown): FlowAction[] {
  if (Array.isArray(node)) return node.flatMap(collectActions);
  if (!node || typeof node !== 'object') return [];

  const record = node as Record<string, unknown>;
  const action = (record['on-click-action'] ?? record['on-select-action']) as
    | FlowAction
    | undefined;

  return [
    ...(action ? [action] : []),
    ...Object.values(record).flatMap(collectActions),
  ];
}

const actions = flow.screens.flatMap((screen) => collectActions(screen.layout));

describe('booking-flow.json', () => {
  it('declara la misma versión de protocolo que usa el endpoint', () => {
    expect(flow.data_api_version).toBe(FLOW_DATA_API_VERSION);
  });

  it('tiene las dos pantallas que el endpoint sabe construir', () => {
    expect(flow.screens.map((screen) => screen.id)).toEqual([
      FLOW_SCREENS.BOOKING,
      FLOW_SCREENS.SUMMARY,
    ]);
  });

  it('todo campo de datos trae __example__', () => {
    const sinEjemplo = flow.screens.flatMap((screen) =>
      Object.entries(screen.data ?? {})
        .filter(([, field]) => !isRecord(field) || !('__example__' in field))
        .map(([name]) => `${screen.id}.${name}`),
    );

    expect(sinEjemplo).toEqual([]);
  });

  it('los triggers del JSON son exactamente los que atiende el endpoint', () => {
    const declarados = actions
      .filter((action) => action.name === 'data_exchange')
      .map((action) => action.payload?.trigger)
      .filter((trigger): trigger is string => typeof trigger === 'string');

    expect(new Set(declarados)).toEqual(new Set(Object.values(FLOW_TRIGGERS)));
  });

  it('un navigate cubre todo el modelo de datos de su destino', () => {
    // Es la regla que rechazó el validador de Meta: una transición del lado del
    // cliente no puede dejar campos sin valor, porque el servidor no participa.
    const modelos = Object.fromEntries(
      flow.screens.map((screen) => [screen.id, Object.keys(screen.data ?? {})]),
    );

    for (const action of actions.filter((a) => a.name === 'navigate')) {
      const destino = action.next?.name ?? '';
      const enviados = Object.keys(action.payload ?? {});
      const faltantes = (modelos[destino] ?? []).filter(
        (campo) => !enviados.includes(campo),
      );

      expect({ destino, faltantes }).toEqual({ destino, faltantes: [] });
    }
  });

  it('la pantalla final está marcada como terminal', () => {
    const summary = flow.screens.find((s) => s.id === FLOW_SCREENS.SUMMARY);
    expect(summary?.terminal).toBe(true);
  });

  it('el routing_model declara la transición que usa el endpoint', () => {
    expect(flow.routing_model[FLOW_SCREENS.BOOKING]).toContain(
      FLOW_SCREENS.SUMMARY,
    );
  });
});
