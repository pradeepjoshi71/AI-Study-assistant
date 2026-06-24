import { IsString, IsEmail, IsOptional, Matches, MinLength, MaxLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with dashes' })
  @MinLength(2)
  @MaxLength(50)
  slug!: string;

  @IsEmail()
  @IsOptional()
  billingEmail?: string;
}
