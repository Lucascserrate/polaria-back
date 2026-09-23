import { assignDistinctStaff, canAssignDistinctStaff } from './staff-matching';

const ANA = 'ana';
const BETO = 'beto';
const CARLA = 'carla';

describe('assignDistinctStaff', () => {
  it('sin tramos no hay nada que repartir', () => {
    expect(assignDistinctStaff([])).toEqual([]);
  });

  it('un solo tramo se lleva al primero de su lista', () => {
    expect(assignDistinctStaff([[ANA, BETO]])).toEqual([ANA]);
  });

  it('un tramo sin candidatos no se puede cubrir', () => {
    expect(assignDistinctStaff([[ANA], []])).toBeNull();
  });

  it('dos tramos con dos personas distintas se reparten', () => {
    expect(assignDistinctStaff([[ANA], [BETO]])).toEqual([ANA, BETO]);
  });

  it('respeta la preferencia cuando alcanza para todos', () => {
    // Las dos prefieren a Ana, pero Beto también puede el segundo.
    expect(
      assignDistinctStaff([
        [ANA, BETO],
        [ANA, BETO],
      ]),
    ).toEqual([ANA, BETO]);
  });

  /**
   * El caso que justifica el algoritmo entero.
   *
   * El primer tramo se queda con Ana porque es su única opción, pero si se
   * resolviera en el otro orden —el segundo tramo elige primero y toma a Ana—
   * el primero se quedaría sin nadie y el horario no se ofrecería, existiendo.
   */
  it('reacomoda a quien ya estaba asignado antes que declarar imposible', () => {
    expect(assignDistinctStaff([[ANA], [ANA, BETO]])).toEqual([ANA, BETO]);
    expect(assignDistinctStaff([[ANA, BETO], [ANA]])).toEqual([BETO, ANA]);
  });

  it('con una sola persona para dos tramos simultáneos no hay reparto', () => {
    expect(assignDistinctStaff([[ANA], [ANA]])).toBeNull();
  });

  /**
   * El salón de uñas con una sola profesional habilitada para las dos cosas.
   *
   * Las dos listas son no vacías, así que preguntar tramo por tramo diría que
   * está disponible y la cita pondría a Ana en dos sillas a la vez.
   */
  it('dos tramos que comparten su único candidato no se pueden cubrir', () => {
    expect(canAssignDistinctStaff([[ANA], [ANA]])).toBe(false);
    expect(canAssignDistinctStaff([[ANA], [BETO]])).toBe(true);
  });

  it('tres tramos con tres personas encadenadas se resuelven', () => {
    expect(
      assignDistinctStaff([[ANA], [ANA, BETO], [ANA, BETO, CARLA]]),
    ).toEqual([ANA, BETO, CARLA]);
  });

  it('tres tramos con dos personas no alcanzan', () => {
    expect(
      assignDistinctStaff([
        [ANA, BETO],
        [ANA, BETO],
        [ANA, BETO],
      ]),
    ).toBeNull();
  });

  it('el mismo pedido da siempre el mismo reparto', () => {
    const request = [[ANA, BETO, CARLA], [BETO, CARLA], [CARLA]];

    expect(assignDistinctStaff(request)).toEqual(assignDistinctStaff(request));
  });

  it('nunca repite a nadie en el reparto que devuelve', () => {
    const assignment = assignDistinctStaff([
      [ANA, BETO, CARLA],
      [ANA, BETO],
      [ANA],
    ]);

    expect(assignment).not.toBeNull();
    expect(new Set(assignment).size).toBe(assignment!.length);
  });
});
