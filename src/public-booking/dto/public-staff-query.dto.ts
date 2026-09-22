import { ServiceIdsParam } from './booking-selection';

/**
 * Los servicios para los que se pregunta quién atiende.
 *
 * Es un DTO y no un `@Query('serviceId')` suelto porque ahora son varios y hay
 * que validarlos: sin tope, una lista larga escrita a mano en la URL serían
 * tantas consultas de equipo como ids tuviera.
 */
export class PublicStaffQueryDto {
  @ServiceIdsParam()
  serviceIds!: string[];
}
