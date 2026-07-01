import {
  Controller,
  Post,
  Body,
  Req,
  ForbiddenException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from './audit.service';

@Controller('internal/audit')
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditService: AuditService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async logInternalAudit(@Body() body: any, @Req() req: Request) {
    const clientIp = req.ip || req.connection?.remoteAddress || '';
    
    // IP Whitelist Check (Allow localhost loopback, standard Docker bridge networks, and dev mode overrides)
    const isLoopback =
      clientIp === '127.0.0.1' ||
      clientIp === '::1' ||
      clientIp.includes('127.0.0.1') ||
      clientIp === 'localhost';

    const isInternalDockerOrPrivate =
      clientIp.startsWith('172.') ||
      clientIp.includes(':172.') ||
      clientIp.startsWith('10.') ||
      clientIp.startsWith('192.168.') ||
      clientIp.startsWith('::ffff:172.') ||
      clientIp.startsWith('::ffff:10.') ||
      clientIp.startsWith('::ffff:192.168.');

    const isAllowed = isLoopback || isInternalDockerOrPrivate || process.env.NODE_ENV === 'development';

    if (!isAllowed) {
      this.logger.warn(`Rejected unauthorized internal audit attempt from IP: ${clientIp}`);
      throw new ForbiddenException('Access denied: Internal network only');
    }

    // Dispatch to AuditService log queue
    await this.auditService.log({
      organizationId: body.orgId || body.organizationId || null,
      userId: body.userId || null,
      actorId: body.actorId || 'system',
      actorType: body.actorType || 'system',
      action: body.action || 'internal.event',
      resourceType: body.resourceType || 'internal',
      resourceId: body.resourceId || null,
      metadata: body.metadata || {},
      ipAddress: body.ip || body.ipAddress || clientIp,
      userAgent: body.userAgent || null,
    });

    return { success: true };
  }
}
