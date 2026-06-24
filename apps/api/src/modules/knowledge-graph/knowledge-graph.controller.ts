import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { BuildGraphDto, ExpandQueryDto } from './knowledge-graph.types';

@Controller('graph')
@UseGuards(JwtAuthGuard)
export class KnowledgeGraphController {
  constructor(private readonly graphService: KnowledgeGraphService) {}

  /**
   * POST /api/graph/build
   * Asynchronously builds the concept graph from a document's chunks.
   * Returns immediately — graph construction runs in the background.
   */
  @Post('build')
  @HttpCode(HttpStatus.ACCEPTED)
  async buildGraph(@Body() dto: BuildGraphDto, @Req() req: any) {
    const tenantId: string = req.user.tenantId;
    return this.graphService.buildGraph(tenantId, dto);
  }

  /**
   * GET /api/graph/concepts/:concept
   * Returns the concept node with all its direct neighbors and typed edges.
   * Used by the frontend Knowledge Graph explorer panel.
   */
  @Get('concepts/:concept')
  async getConceptNetwork(@Param('concept') concept: string, @Req() req: any) {
    const tenantId: string = req.user.tenantId;
    return this.graphService.getConceptNetwork(concept, tenantId);
  }

  /**
   * GET /api/graph/explain/:concept
   * Returns an AI-generated pedagogical explanation of the concept cluster.
   */
  @Get('explain/:concept')
  async explainConcept(@Param('concept') concept: string, @Req() req: any) {
    const tenantId: string = req.user.tenantId;
    const explanation = await this.graphService.explainConcept(concept, tenantId);
    return { concept, explanation };
  }

  /**
   * POST /api/graph/expand-query
   * Expands a user query using graph BFS traversal.
   * Returns a list of related concept terms to enrich Qdrant retrieval.
   */
  @Post('expand-query')
  async expandQuery(@Body() dto: ExpandQueryDto, @Req() req: any) {
    const tenantId: string = req.user.tenantId;
    const terms = await this.graphService.expandQuery(
      dto.query,
      tenantId,
      dto.maxHops ?? 2,
    );
    return { query: dto.query, expandedTerms: terms };
  }
}

