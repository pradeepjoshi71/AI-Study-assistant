import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FlashcardService } from './flashcards.service';
import { GenerateFlashcardsDto } from './flashcards.types';

@UseGuards(JwtAuthGuard)
@Controller('study')
export class FlashcardController {
  constructor(private flashcardService: FlashcardService) {}

  @Post('flashcards/generate')
  async generateFlashcards(
    @Body() dto: GenerateFlashcardsDto,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId; // tenant isolation fallback
    return this.flashcardService.generateFlashcards(userId, tenantId, dto);
  }

  @Get('flashcards/deck/:id')
  async getDeck(
    @Param('id') deckId: string,
    @CurrentUser('id') userId: string,
  ) {
    const tenantId = userId;
    return this.flashcardService.getDeck(userId, tenantId, deckId);
  }

  @Get('flashcards/decks')
  async listDecks(@CurrentUser('id') userId: string) {
    const tenantId = userId;
    return this.flashcardService.listDecks(userId, tenantId);
  }
}
