import type { SlotRange } from '../utils/availability.types';
import {
  calculateWorkloadByStaffId,
  resolveStaffForSlot,
} from './staff-assignment';

const NICO = 'aaaa-nico';
const ANA = 'bbbb-ana';
const RAUL = 'cccc-raul';

function appointment(hour: number, durationMinutes: number): SlotRange {
  const startTime = new Date(Date.UTC(2026, 6, 31, hour, 0, 0));
  return {
    startTime,
    endTime: new Date(startTime.getTime() + durationMinutes * 60_000),
  };
}

describe('calculateWorkloadByStaffId', () => {
  it('suma minutos agendados, no cantidad de reservas', () => {
    const workload = calculateWorkloadByStaffId({
      // Dos cortes rápidos: 60 minutos en total.
      [NICO]: [appointment(9, 30), appointment(11, 30)],
      // Una sola decoloración: 180 minutos.
      [ANA]: [appointment(9, 180)],
    });

    expect(workload).toEqual({ [NICO]: 60, [ANA]: 180 });
  });

  it('asigna carga cero a un profesional sin citas', () => {
    expect(calculateWorkloadByStaffId({ [NICO]: [] })).toEqual({ [NICO]: 0 });
  });
});

describe('resolveStaffForSlot', () => {
  it('devuelve el único candidato sin mirar la carga', () => {
    const staffId = resolveStaffForSlot({
      eligibleStaffIds: [NICO],
      workloadByStaffId: { [NICO]: 999 },
    });

    expect(staffId).toBe(NICO);
  });

  it('elige al de menor carga en minutos', () => {
    const staffId = resolveStaffForSlot({
      eligibleStaffIds: [NICO, ANA],
      workloadByStaffId: { [NICO]: 180, [ANA]: 60 },
    });

    expect(staffId).toBe(ANA);
  });

  it('no confunde cantidad de reservas con carga', () => {
    // Nico tiene 4 reservas cortas (120 min); Ana una sola larga (180 min).
    const workloadByStaffId = calculateWorkloadByStaffId({
      [NICO]: [
        appointment(9, 30),
        appointment(10, 30),
        appointment(11, 30),
        appointment(12, 30),
      ],
      [ANA]: [appointment(9, 180)],
    });

    expect(
      resolveStaffForSlot({
        eligibleStaffIds: [NICO, ANA],
        workloadByStaffId,
      }),
    ).toBe(NICO);
  });

  it('ante empate desempata por id ascendente, no al azar', () => {
    const workloadByStaffId = { [RAUL]: 60, [NICO]: 60, [ANA]: 60 };

    expect(
      resolveStaffForSlot({
        eligibleStaffIds: [RAUL, ANA, NICO],
        workloadByStaffId,
      }),
    ).toBe(NICO);
  });

  it('es determinista: el orden de entrada no cambia el resultado', () => {
    const workloadByStaffId = { [NICO]: 60, [ANA]: 60 };

    const permutations = [
      [NICO, ANA],
      [ANA, NICO],
    ];

    const results = permutations.map((eligibleStaffIds) =>
      resolveStaffForSlot({ eligibleStaffIds, workloadByStaffId }),
    );

    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(NICO);
  });

  it('trata como carga cero al profesional ausente del mapa', () => {
    const staffId = resolveStaffForSlot({
      eligibleStaffIds: [NICO, ANA],
      workloadByStaffId: { [NICO]: 30 },
    });

    expect(staffId).toBe(ANA);
  });

  it('devuelve null sin candidatos: el horario dejó de estar disponible', () => {
    expect(
      resolveStaffForSlot({ eligibleStaffIds: [], workloadByStaffId: {} }),
    ).toBeNull();
  });

  it('no muta el array de candidatos recibido', () => {
    const eligibleStaffIds = [RAUL, NICO];
    resolveStaffForSlot({
      eligibleStaffIds,
      workloadByStaffId: { [RAUL]: 10, [NICO]: 200 },
    });

    expect(eligibleStaffIds).toEqual([RAUL, NICO]);
  });
});
