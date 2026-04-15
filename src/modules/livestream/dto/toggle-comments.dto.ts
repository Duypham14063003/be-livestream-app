import { IsBoolean } from 'class-validator';

export class ToggleCommentsDto {
  @IsBoolean()
  enabled!: boolean;
}