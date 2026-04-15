import { IsNotEmpty, IsNumber, IsString, Min } from "class-validator";

export class CreateSeatDto {
  @IsNotEmpty()
  @IsString()
  zone!: string;

  @IsNotEmpty()
  @IsString()
  row!: string;

  @IsNotEmpty()
  @IsString()
  number!: string;

  @IsNumber()
  @Min(0)
  price!: number;
}
