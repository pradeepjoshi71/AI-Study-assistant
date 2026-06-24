import { IsOptional, IsString } from "class-validator";

export class UploadDocumentDto {
  @IsString()
  @IsOptional()
  title?: string;
}
