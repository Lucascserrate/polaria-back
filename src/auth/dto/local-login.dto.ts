import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class LocalLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}
