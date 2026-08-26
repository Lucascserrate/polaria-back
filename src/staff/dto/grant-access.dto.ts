import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class GrantAccessDto {
  @ApiProperty({
    description:
      'Correo con el que el miembro del equipo va a entrar a Polaria. ' +
      'Se guarda normalizado en minúsculas.',
    example: 'marco@barberia.com',
  })
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
