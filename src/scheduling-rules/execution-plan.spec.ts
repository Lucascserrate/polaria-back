import {
  buildExecutionPlans,
  isParallelPlan,
  pickPlanForAssignment,
  roundsOf,
  sequentialPlan,
  type PlannableService,
} from './execution-plan';
import { ParallelPairs } from './parallel-pairs';

const MANICURES = 'cat-manicures';
const PEDICURES = 'cat-pedicures';
const CEJAS = 'cat-cejas';

const service = (
  serviceId: string,
  categoryId: string | null,
  durationMinutes: number,
): PlannableService => ({ serviceId, categoryId, durationMinutes });

/** Las reglas del negocio escritas como las escribiría el panel. */
const rules = (...pairs: Array<[string, string]>) => {
  const set = new ParallelPairs(
    pairs.map(([categoryAId, categoryBId]) => ({ categoryAId, categoryBId })),
  );
  return (a: string, b: string) => set.allows(a, b);
};

/** Nunca nada en paralelo: el negocio que no configuró ninguna regla. */
const noRules = () => false;

/** El reparto de un plan, legible: `[['a','b'],['c']]`. */
const grouping = (plan: ReturnType<typeof sequentialPlan>) =>
  roundsOf(plan).map((round) => round.map((placement) => placement.serviceId));

describe('buildExecutionPlans', () => {
  describe('sin reglas cargadas, que es como arranca todo negocio', () => {
    it('devuelve un solo plan y es el encadenado de siempre', () => {
      const plans = buildExecutionPlans({
        services: [
          service('corte', 'cat-cortes', 30),
          service('barba', 'cat-barbas', 20),
        ],
        canRunInParallel: noRules,
      });

      expect(plans).toHaveLength(1);
      expect(plans[0].totalDurationMinutes).toBe(50);
      expect(plans[0].maxConcurrency).toBe(1);
      expect(plans[0].placements.map((p) => p.offsetMinutes)).toEqual([0, 30]);
    });

    it('un solo servicio no pasa por ninguna rama nueva', () => {
      const plans = buildExecutionPlans({
        services: [service('corte', 'cat-cortes', 30)],
        canRunInParallel: noRules,
      });

      expect(plans).toEqual([
        {
          placements: [
            {
              serviceId: 'corte',
              offsetMinutes: 0,
              durationMinutes: 30,
              roundIndex: 0,
            },
          ],
          totalDurationMinutes: 30,
          roundCount: 1,
          maxConcurrency: 1,
        },
      ]);
    });
  });

  describe('el salón de uñas: manicure y pedicure', () => {
    const uñas = [
      service('manicure-gel', MANICURES, 60),
      service('pedicure-spa', PEDICURES, 60),
    ];

    it('ofrece primero el plan simultáneo y después el encadenado', () => {
      const plans = buildExecutionPlans({
        services: uñas,
        canRunInParallel: rules([MANICURES, PEDICURES]),
      });

      expect(plans).toHaveLength(2);

      expect(plans[0].totalDurationMinutes).toBe(60);
      expect(plans[0].maxConcurrency).toBe(2);
      expect(grouping(plans[0])).toEqual([['manicure-gel', 'pedicure-spa']]);

      expect(plans[1].totalDurationMinutes).toBe(120);
      expect(plans[1].maxConcurrency).toBe(1);
      expect(grouping(plans[1])).toEqual([['manicure-gel'], ['pedicure-spa']]);
    });

    it('los dos servicios simultáneos arrancan en el mismo instante', () => {
      const [parallel] = buildExecutionPlans({
        services: uñas,
        canRunInParallel: rules([MANICURES, PEDICURES]),
      });

      expect(parallel.placements.map((p) => p.offsetMinutes)).toEqual([0, 0]);
      expect(parallel.placements.map((p) => p.roundIndex)).toEqual([0, 0]);
    });

    it('el plan encadenado sigue disponible como último recurso', () => {
      const plans = buildExecutionPlans({
        services: uñas,
        canRunInParallel: rules([MANICURES, PEDICURES]),
      });

      const last = plans[plans.length - 1];
      expect(last.maxConcurrency).toBe(1);
      expect(isParallelPlan(last)).toBe(false);
    });
  });

  describe('duraciones distintas', () => {
    it('la tanda dura lo que su servicio más largo', () => {
      const [parallel] = buildExecutionPlans({
        services: [
          service('manicure-gel', MANICURES, 60),
          service('pedicure-express', PEDICURES, 30),
        ],
        canRunInParallel: rules([MANICURES, PEDICURES]),
      });

      expect(parallel.totalDurationMinutes).toBe(60);
      expect(parallel.placements.map((p) => p.durationMinutes)).toEqual([
        60, 30,
      ]);
    });

    it('la tanda siguiente empieza cuando termina el más largo, no el primero', () => {
      const plans = buildExecutionPlans({
        services: [
          service('manicure-gel', MANICURES, 60),
          service('pedicure-express', PEDICURES, 30),
          service('cejas', CEJAS, 15),
        ],
        canRunInParallel: rules([MANICURES, PEDICURES]),
      });

      const best = plans[0];
      expect(best.totalDurationMinutes).toBe(75);
      expect(grouping(best)).toEqual([
        ['manicure-gel', 'pedicure-express'],
        ['cejas'],
      ]);
      expect(
        best.placements.find((p) => p.serviceId === 'cejas')?.offsetMinutes,
      ).toBe(60);
    });
  });

  describe('tres o más servicios', () => {
    it('agrupa los tres cuando todos conviven entre sí', () => {
      const plans = buildExecutionPlans({
        services: [
          service('manicure', MANICURES, 60),
          service('pedicure', PEDICURES, 60),
          service('cejas', CEJAS, 30),
        ],
        canRunInParallel: rules(
          [MANICURES, PEDICURES],
          [MANICURES, CEJAS],
          [PEDICURES, CEJAS],
        ),
      });

      expect(plans[0].totalDurationMinutes).toBe(60);
      expect(plans[0].maxConcurrency).toBe(3);
      expect(grouping(plans[0])).toEqual([['manicure', 'pedicure', 'cejas']]);
    });

    it('no agrupa en cadena: una tanda exige compatibilidad entre todos sus pares', () => {
      /*
       * Las uñas conviven con los pies y los pies con las cejas, pero las uñas
       * con las cejas no. Los tres juntos tendrían un par que nadie declaró.
       */
      const plans = buildExecutionPlans({
        services: [
          service('manicure', MANICURES, 60),
          service('pedicure', PEDICURES, 60),
          service('cejas', CEJAS, 60),
        ],
        canRunInParallel: rules([MANICURES, PEDICURES], [PEDICURES, CEJAS]),
      });

      for (const plan of plans) {
        for (const round of grouping(plan)) {
          expect(round).not.toEqual(
            expect.arrayContaining(['manicure', 'cejas']),
          );
        }
      }

      expect(plans[0].totalDurationMinutes).toBe(120);
      expect(plans[0].maxConcurrency).toBe(2);
    });
  });

  describe('lo que nunca se paraleliza', () => {
    it('dos servicios de la misma categoría, aunque la regla exista', () => {
      const plans = buildExecutionPlans({
        services: [
          service('manicure-gel', MANICURES, 60),
          service('manicure-francesa', MANICURES, 60),
        ],
        canRunInParallel: () => true,
      });

      expect(plans).toHaveLength(1);
      expect(plans[0].totalDurationMinutes).toBe(120);
    });

    it('un servicio sin categoría', () => {
      const plans = buildExecutionPlans({
        services: [
          service('manicure-gel', MANICURES, 60),
          service('suelto', null, 60),
        ],
        canRunInParallel: () => true,
      });

      expect(plans).toHaveLength(1);
      expect(plans[0].totalDurationMinutes).toBe(120);
    });
  });

  describe('el orden de los planes', () => {
    it('primero el más corto, y a igual duración el que necesita menos gente', () => {
      const plans = buildExecutionPlans({
        services: [
          service('manicure', MANICURES, 60),
          service('pedicure', PEDICURES, 60),
          service('cejas', CEJAS, 60),
        ],
        canRunInParallel: rules(
          [MANICURES, PEDICURES],
          [MANICURES, CEJAS],
          [PEDICURES, CEJAS],
        ),
      });

      const durations = plans.map((plan) => plan.totalDurationMinutes);
      expect(durations).toEqual([...durations].sort((a, b) => a - b));

      const sameDuration = plans.filter((p) => p.totalDurationMinutes === 120);
      const concurrencies = sameDuration.map((p) => p.maxConcurrency);
      expect(concurrencies).toEqual([...concurrencies].sort((a, b) => a - b));
    });

    it('la misma consulta da siempre el mismo orden', () => {
      const build = () =>
        buildExecutionPlans({
          services: [
            service('manicure', MANICURES, 60),
            service('pedicure', PEDICURES, 45),
            service('cejas', CEJAS, 30),
          ],
          canRunInParallel: rules([MANICURES, PEDICURES], [MANICURES, CEJAS]),
        });

      expect(build()).toEqual(build());
    });

    it('conserva el orden en que el cliente eligió los servicios', () => {
      const plans = buildExecutionPlans({
        services: [
          service('pedicure', PEDICURES, 60),
          service('manicure', MANICURES, 60),
        ],
        canRunInParallel: rules([MANICURES, PEDICURES]),
      });

      for (const plan of plans) {
        expect(plan.placements.map((p) => p.serviceId)).toEqual([
          'pedicure',
          'manicure',
        ]);
      }
    });
  });

  describe('límites', () => {
    it('sin servicios no hay planes', () => {
      expect(
        buildExecutionPlans({ services: [], canRunInParallel: () => true }),
      ).toEqual([]);
    });

    it('por encima del tope sólo se ofrece el encadenado', () => {
      const many = Array.from({ length: 7 }, (_, index) =>
        service(`s${index}`, `cat-${index}`, 30),
      );

      const plans = buildExecutionPlans({
        services: many,
        canRunInParallel: () => true,
      });

      expect(plans).toHaveLength(1);
      expect(plans[0].totalDurationMinutes).toBe(210);
      expect(plans[0].maxConcurrency).toBe(1);
    });

    it('cinco servicios que conviven todos no explotan la enumeración', () => {
      const five = Array.from({ length: 5 }, (_, index) =>
        service(`s${index}`, `cat-${index}`, 30),
      );

      const plans = buildExecutionPlans({
        services: five,
        canRunInParallel: () => true,
      });

      // Las 52 formas de repartir cinco elementos, ni una más.
      expect(plans).toHaveLength(52);
      expect(plans[0].totalDurationMinutes).toBe(30);
      expect(plans[plans.length - 1].totalDurationMinutes).toBe(150);
    });
  });
});

describe('sequentialPlan', () => {
  it('es lo que Polaria hizo siempre: cada servicio detrás del anterior', () => {
    const plan = sequentialPlan([
      service('corte', 'cat-cortes', 30),
      service('barba', 'cat-barbas', 20),
    ]);

    expect(plan.placements.map((p) => p.offsetMinutes)).toEqual([0, 30]);
    expect(plan.totalDurationMinutes).toBe(50);
    expect(isParallelPlan(plan)).toBe(false);
  });
});

/**
 * Cómo el panel deduce el reparto a partir de a quién asignó.
 *
 * No elige un horario de una lista, así que lo único que dice si dos servicios
 * van juntos es si les puso personas distintas.
 */
describe('pickPlanForAssignment', () => {
  const planes = () =>
    buildExecutionPlans({
      services: [
        service('manicure', MANICURES, 60),
        service('pedicure', PEDICURES, 60),
      ],
      canRunInParallel: rules([MANICURES, PEDICURES]),
    });

  it('con dos personas distintas toma el plan simultáneo', () => {
    const plan = pickPlanForAssignment(planes(), ['maria', 'barbara']);

    expect(plan?.totalDurationMinutes).toBe(60);
    expect(plan?.placements.map((p) => p.offsetMinutes)).toEqual([0, 0]);
  });

  it('con la misma persona en los dos cae al encadenado', () => {
    const plan = pickPlanForAssignment(planes(), ['maria', 'maria']);

    expect(plan?.totalDurationMinutes).toBe(120);
    expect(plan?.placements.map((p) => p.offsetMinutes)).toEqual([0, 60]);
  });

  /*
   * Dos servicios sin profesional no son el mismo profesional. Suponerlo
   * escondería el plan corto justo mientras la reserva se está armando, que es
   * cuando el drawer necesita mostrar cuánto va a durar.
   */
  it('sin asignar no choca con nadie', () => {
    const plan = pickPlanForAssignment(planes(), [undefined, undefined]);

    expect(plan?.totalDurationMinutes).toBe(60);
  });

  it('una sola posición asignada no bloquea a la otra', () => {
    const plan = pickPlanForAssignment(planes(), ['maria', null]);

    expect(plan?.totalDurationMinutes).toBe(60);
  });

  it('sin planes no hay nada que elegir', () => {
    expect(pickPlanForAssignment([], ['maria'])).toBeNull();
  });
});
