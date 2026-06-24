import { Controller, Post, Body, UseGuards, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { SearchQueryDto } from './dto/search-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('rag')
export class RagController {
  private readonly aiServiceUrl: string;
  private readonly logger = new Logger(RagController.name);

  constructor(
    private documentsService: DocumentsService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  @Post('search')
  async search(@Body() dto: SearchQueryDto, @CurrentUser('id') userId: string) {
    this.logger.log(`RAG search query initiated by user: ${userId}`);

    let targetDocIds = dto.documentIds;

    // 1. If documentIds list is empty/missing, resolve to all documents owned by user
    if (!targetDocIds || targetDocIds.length === 0) {
      const ownedDocs = await this.documentsService.findAll(userId);
      targetDocIds = ownedDocs.map((d) => d.id);
    } else {
      // 2. Validate ownership of all passed documentIds (throws Forbidden if not owned)
      for (const docId of targetDocIds) {
        await this.documentsService.findOne(docId, userId);
      }
    }

    // If the user has no documents uploaded, return empty context
    if (targetDocIds.length === 0) {
      return {
        chunks: [],
        context: '',
        sources: [],
        pages: [],
      };
    }

    // 3. Forward request to Python FastAPI RAG retrieval service
    try {
      const targetUrl = `${this.aiServiceUrl}/ai/rag/search`;
      this.logger.log(`Forwarding query to AI microservice: ${targetUrl}`);

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          query: dto.query,
          documentIds: targetDocIds,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`AI Service RAG search failed: ${response.status} - ${errorText}`);
        throw new InternalServerErrorException('AI Service retrieval failed');
      }

      return response.json();
    } catch (err: any) {
      this.logger.error(`Connection failure to AI microservice: ${err.message}`);
      throw new InternalServerErrorException('AI Service connection error');
    }
  }
}
