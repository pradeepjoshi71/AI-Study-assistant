import { IsString, IsNotEmpty, IsEnum, IsInt, Min, Max, IsOptional } from 'class-validator';

export enum GroupVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export class CreateStudyGroupDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(GroupVisibility)
  visibility!: GroupVisibility;

  @IsInt()
  @Min(2)
  @Max(100)
  @IsOptional()
  maxMembers?: number;
}
