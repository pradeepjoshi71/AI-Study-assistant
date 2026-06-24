import { IsString, IsEnum } from 'class-validator';

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
