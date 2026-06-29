import { IsString, IsEnum, IsOptional } from 'class-validator';
import { RecallStatus } from '../analytics/analytics.types';

export enum FlashcardMode {
  BASIC = 'basic',
  EXAM = 'exam',
  REVISION = 'revision',
}

export class GenerateFlashcardsDto {
  @IsString()
  conversationId!: string;

  @IsEnum(FlashcardMode)
  mode!: FlashcardMode;
}

export class SubmitFlashcardReviewDto {
  @IsEnum(RecallStatus)
  recallStatus!: RecallStatus;

  @IsOptional()
  score?: number;
}

