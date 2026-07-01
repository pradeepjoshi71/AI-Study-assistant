import { Controller, Get, Header, Res, HttpStatus } from '@nestjs/common';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';

import { RequiresFeature } from "../../common/guards/tenant-feature.guard";

@ApiTags('Public OpenAPI Specification')
@Controller({ path: 'api/public/v1/openapi.json', version: VERSION_NEUTRAL })
@RequiresFeature("api_access")
export class PublicOpenApiController {
  @Get()
  @Header('Content-Type', 'application/json')
  @Header('Access-Control-Allow-Origin', '*') // Allow SwaggerUI or playground to fetch it from frontend
  @ApiOperation({ summary: 'Get OpenAPI Specification JSON', description: 'Retrieve the raw OpenAPI Swagger specification for this platform.' })
  @ApiResponse({ status: 200, description: 'OpenAPI specification retrieved successfully.' })
  getOpenApiSpec(@Res() res: Response) {
    const searchPaths = [
      path.join(process.cwd(), 'openapi.json'),
      path.join(process.cwd(), 'apps/api/openapi.json'),
      path.join(__dirname, '../../../openapi.json'),
      path.join(__dirname, '../../../../openapi.json'),
    ];

    let foundPath: string | null = null;
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (foundPath) {
      const stream = fs.createReadStream(foundPath);
      stream.pipe(res);
    } else {
      res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        error: 'OpenAPI specification JSON file not found on the server. Please trigger a build to generate it.',
      });
    }
  }
}
