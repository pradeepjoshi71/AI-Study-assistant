import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'Search query is required' })
  query!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  documentIds?: string[];
}
