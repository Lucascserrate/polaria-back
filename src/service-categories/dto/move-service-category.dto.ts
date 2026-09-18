import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

/** Hacia dónde se mueve una categoría, un lugar por vez. */
export enum MoveDirection {
  UP = 'UP',
  DOWN = 'DOWN',
}

export class MoveServiceCategoryDto {
  @ApiProperty({ enum: MoveDirection })
  @IsEnum(MoveDirection)
  direction: MoveDirection;
}
