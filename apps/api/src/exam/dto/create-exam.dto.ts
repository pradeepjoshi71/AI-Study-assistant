import {
  IsString,
  IsArray,
  IsInt,
  IsEnum,
  IsObject,
  IsNumber,
  Min,
  Max,
  ArrayMinSize,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

// Keep as string literals so the DTO compiles before `prisma generate` runs.
// Values are validated by @IsEnum at runtime.
export enum ExamTypeEnum {
  PRACTICE = 'PRACTICE',
  MOCK     = 'MOCK',
  TIMED    = 'TIMED',
}

export enum QuestionTypeEnum {
  MCQ        = 'MCQ',
  TRUE_FALSE = 'TRUE_FALSE',
  SHORT      = 'SHORT',
  FILL       = 'FILL',
}

export class DifficultyMixDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  easy!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  medium!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  hard!: number;
}

export class CreateExamDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  docIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  topicIds!: string[];

  @IsInt()
  @Min(1)
  @Max(200)
  totalQuestions!: number;

  @IsInt()
  @Min(1)
  @Max(360)
  durationMinutes!: number;

  @IsObject()
  @ValidateNested()
  @Type(() => DifficultyMixDto)
  difficultyMix!: DifficultyMixDto;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(QuestionTypeEnum, { each: true })
  questionTypes!: QuestionTypeEnum[];

  @IsEnum(ExamTypeEnum)
  type!: ExamTypeEnum;
}
