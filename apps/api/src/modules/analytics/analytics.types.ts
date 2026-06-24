import { IsString, IsNumber, IsEnum, Min } from 'class-validator';

export class LogSessionDto {
  @IsNumber()
  @Min(1)
  duration!: number; // in seconds
}

export class LogQuizAttemptDto {
  @IsString()
  quizId!: string;

  @IsNumber()
  @Min(0)
  correctAnswers!: number;

  @IsNumber()
  @Min(0)
  wrongAnswers!: number;
}

export enum RecallStatus {
  EASY = 'easy',
  HARD = 'hard',
  FAIL = 'fail',
}

export class LogFlashcardReviewDto {
  @IsString()
  flashcardId!: string;

  @IsEnum(RecallStatus)
  recallStatus!: RecallStatus;
}
