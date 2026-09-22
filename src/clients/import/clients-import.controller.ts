import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { AdminOnly, RolesGuard } from '../../auth/guards/roles.guard';
import { Actor, type AuthenticatedActor } from '../../auth/actor';
import {
  assertUploadedCsv,
  CSV_UPLOAD_OPTIONS,
  type UploadedCsvFile,
} from './csv-upload';
import {
  ClientsImportService,
  type ImportOptions,
} from './clients-import.service';
import { ImportClientsDto } from './dto/import-clients.dto';

/** El cuerpo es el archivo más el mapeo, y Swagger no lo deduce de un DTO. */
const CSV_BODY = {
  schema: {
    type: 'object',
    properties: {
      file: { type: 'string', format: 'binary' },
      nameColumns: { type: 'array', items: { type: 'string' } },
      phoneColumns: { type: 'array', items: { type: 'string' } },
      emailColumns: { type: 'array', items: { type: 'string' } },
      dialCode: { type: 'string' },
      fillMissing: { type: 'boolean' },
    },
    required: ['file'],
  },
};

/**
 * Importar la agenda de contactos del negocio desde un CSV.
 *
 * Controlador propio y no un par de rutas más en `ClientsController`: ahí todo
 * son operaciones sobre una ficha, y esto es un archivo, un análisis y una
 * escritura en lote. Comparte el servicio de clientes —el mismo `dialCodeFor`,
 * la misma normalización de teléfonos— que es lo que importa que no se duplique.
 *
 * Las dos rutas reciben lo mismo. La diferencia es que `preview` no escribe
 * nada, y existe separada en lugar de como un parámetro `dryRun` porque "mirar"
 * y "escribir mil fichas" no deberían distinguirse por una letra en la query.
 *
 * `@AdminOnly`: cargar la cartera de clientes no es algo que haga un profesional
 * desde su agenda.
 */
@ApiTags('clients')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('clients/import')
export class ClientsImportController {
  constructor(private readonly importService: ClientsImportService) {}

  /** Qué pasaría si se importa este archivo. No toca la base. */
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', CSV_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody(CSV_BODY)
  preview(
    @Actor() actor: AuthenticatedActor,
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body() dto: ImportClientsDto,
  ) {
    return this.importService.analyze(
      actor.tenantId,
      assertUploadedCsv(file).buffer,
      optionsFrom(dto),
    );
  }

  /** Importa de verdad. Vuelve a analizar el archivo antes de escribir. */
  @Post()
  @UseInterceptors(FileInterceptor('file', CSV_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody(CSV_BODY)
  run(
    @Actor() actor: AuthenticatedActor,
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body() dto: ImportClientsDto,
  ) {
    return this.importService.run(
      actor.tenantId,
      assertUploadedCsv(file).buffer,
      optionsFrom(dto),
    );
  }
}

/**
 * El formulario traducido a opciones del servicio.
 *
 * Una columna que no vino queda en `undefined` y **no** en lista vacía: son
 * cosas distintas. `undefined` significa "usá lo que detectaste"; una lista
 * vacía significa "este campo no se importa", y es lo que manda la pantalla
 * cuando alguien elige "Sin asignar" para el email.
 *
 * `fillMissing` cae en `true` cuando no viene. Completar un dato vacío no
 * destruye nada, y es lo que espera quien sube una agenda más completa que su
 * cartera.
 */
const optionsFrom = (dto: ImportClientsDto): ImportOptions => ({
  mapping: {
    nameColumns: dto.nameColumns,
    phoneColumns: dto.phoneColumns,
    emailColumns: dto.emailColumns,
  },
  dialCode: dto.dialCode,
  fillMissing: dto.fillMissing ?? true,
});
