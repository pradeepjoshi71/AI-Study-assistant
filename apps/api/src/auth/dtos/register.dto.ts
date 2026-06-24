import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  IsEnum,
} from "class-validator";
import { UserRole } from "@prisma/client";

export class RegisterDto {
  @IsEmail({}, { message: "Invalid email address format" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: "Password is required" })
  @MinLength(6, { message: "Password must be at least 6 characters long" })
  password!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(UserRole, { message: "Role must be STUDENT, TEACHER, or ADMIN" })
  @IsOptional()
  role?: UserRole;
}
