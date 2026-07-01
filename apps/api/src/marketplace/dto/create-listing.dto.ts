import { IsString, IsEnum, IsInt, IsArray, IsOptional, Min, IsNotEmpty, ArrayMaxSize } from "class-validator";
import { ListingType } from "@prisma/client";

export class CreateListingDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsEnum(ListingType)
  type!: ListingType;

  @IsInt()
  @Min(0)
  price!: number; // price in cents (0 = free)

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  tags!: string[];

  @IsInt()
  @Min(1)
  totalItems!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  previewItemCount?: number;
}
