import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
  UseFilters,
  UploadedFile,
  UseInterceptors,
  ParseUUIDPipe,
  Body,
  DefaultValuePipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../api-key/guards/api-key.guard';
import { ApiKeyCtx, ApiKeyContext } from '../../api-key/decorators/api-key-context.decorator';
import { Scopes } from '../../api-key/decorators/scopes.decorator';
import { DocumentsService } from '../../documents/documents.service';
import { envelope } from '../common/envelope';
import { PublicApiExceptionFilter } from '../common/public-api-exception.filter';

class UploadDocumentDto {
  title?: string;
}

@ApiTags('Public Documents')
@ApiBearerAuth('bearer')
@UseGuards(ApiKeyGuard)
@UseFilters(PublicApiExceptionFilter)
@Controller({ path: 'api/public/v1/documents', version: VERSION_NEUTRAL })
export class PublicDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * GET /api/public/v1/documents
   * Cursor-paginated list. Cursor is the document UUID of the last item seen.
   * Scopes: documents:read
   */
  @Get()
  @Scopes('documents:read')
  @ApiOperation({ summary: 'List public documents', description: 'Retrieve a cursor-paginated list of processed organization documents.' })
  @ApiResponse({ status: 200, description: 'List of documents retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key.' })
  @ApiResponse({ status: 403, description: 'Insufficient scopes.' })

  async list(
    @Req() req: Request,
    @ApiKeyCtx() ctx: ApiKeyContext,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const docs = await this.documentsService['prisma'].document.findMany({
      where: { orgId: ctx.orgId },
      take: safeLimit + 1, // fetch one extra to detect next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        originalName: true,
        fileType: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        chunkCount: true,
        pageCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasMore = docs.length > safeLimit;
    const items = hasMore ? docs.slice(0, safeLimit) : docs;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return envelope({ items, nextCursor, hasMore }, req);
  }

  /**
   * GET /api/public/v1/documents/:id
   * Scopes: documents:read
   */
  @Get(':id')
  @Scopes('documents:read')
  @ApiOperation({ summary: 'Get document by ID', description: 'Retrieve metadata details of a specific organization document.' })
  @ApiResponse({ status: 200, description: 'Document metadata retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Document not found.' })
  async getOne(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const doc = await this.documentsService['prisma'].document.findFirst({
      where: { id, orgId: ctx.orgId },
      select: {
        id: true,
        title: true,
        originalName: true,
        fileType: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        errorMessage: true,
        chunkCount: true,
        pageCount: true,
        processingStartedAt: true,
        processingCompletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!doc) {
      throw Object.assign(new Error('Document not found'), { status: 404, code: 'DOCUMENT_NOT_FOUND' });
    }

    return envelope(doc, req);
  }

  /**
   * POST /api/public/v1/documents
   * Multipart file upload — delegates to existing DocumentsService.upload()
   * Scopes: documents:write
   */
  @Post()
  @Scopes('documents:write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload document', description: 'Upload a document file to the organization study processing pipeline.' })
  @ApiResponse({ status: 201, description: 'Document uploaded and processing queued successfully.' })
  async upload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const userId = ctx.userId ?? ctx.orgId; // API key may or may not have a linked user
    const doc = await this.documentsService.upload(file, userId, body.title);

    return envelope(
      {
        id: doc.id,
        title: doc.title,
        originalName: doc.originalName,
        status: doc.status,
        createdAt: doc.createdAt,
      },
      req,
    );
  }

  /**
   * DELETE /api/public/v1/documents/:id
   * Scopes: documents:delete
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Scopes('documents:delete')
  @ApiOperation({ summary: 'Delete document', description: 'Permantently delete a document, its chunks, storage objects, and vector embeddings.' })
  @ApiResponse({ status: 200, description: 'Document deleted successfully.' })
  async remove(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @ApiKeyCtx() ctx: ApiKeyContext,
  ) {
    const userId = ctx.userId ?? ctx.orgId;
    const result = await this.documentsService.delete(id, userId);
    return envelope(result, req);
  }
}
