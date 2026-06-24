import { IsString, IsArray, IsOptional, IsEnum, IsNumber, Min, Max } from 'class-validator';

export enum QuizQuestionType {
  MCQ = 'MCQ',
  TRUE_FALSE = 'TRUE_FALSE',
  SHORT_ANSWER = 'SHORT_ANSWER',
}

export enum QuizDifficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

export class GenerateQuizDto {
  @IsString()
  conversationId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

  @IsEnum(QuizDifficulty)
  difficulty!: QuizDifficulty;

  @IsNumber()
  @Min(5)
  @Max(20)
  count!: number;
}

export class SubmitQuizDto {
  @IsNumber()
  @Min(0)
  correctAnswers!: number;

  @IsNumber()
  @Min(0)
  wrongAnswers!: number;
}
