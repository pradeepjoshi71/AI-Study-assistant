import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditService } from '../audit.service';
import { AUDIT_METADATA_KEY, AuditMetadataOptions } from '../decorators/audit.decorator';
import { ActorType } from '@prisma/client';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const handler = context.getHandler();
    const controller = context.getClass();

    // Check if the metadata exists on handler or controller class
    let auditMeta = this.reflector.get<AuditMetadataOptions>(
      AUDIT_METADATA_KEY,
      handler,
    );

    if (!auditMeta) {
      auditMeta = this.reflector.get<AuditMetadataOptions>(
        AUDIT_METADATA_KEY,
        controller,
      );
    }

    const request = context.switchToHttp().getRequest();
    const path = request.path || '';
    const isAdminRoute = path.startsWith('/api/admin') || path.startsWith('/admin');

    // If it's not an admin route and there is no metadata, ignore
    if (!auditMeta && !isAdminRoute) {
      return next.handle();
    }

    // Auto-generate metadata for AdminModule routes if not explicitly decorated
    if (!auditMeta && isAdminRoute) {
      const method = request.method.toLowerCase();
      // e.g. /api/admin/users/123 -> admin.users.update
      const cleanedPath = path
        .replace(/^\/api\/admin/, '')
        .replace(/^\/admin/, '')
        .replace(/\/[a-f0-9-]{36}(\/|$)/gi, '/') // remove uuid parameters
        .replace(/\/$/, ''); // remove trailing slash

      const resourceName = cleanedPath.split('/').filter(Boolean).join('.') || 'action';
      auditMeta = {
        action: `admin.${resourceName}.${method}`,
        resourceType: 'admin',
      };
    }

    const ip = request.ip || request.connection?.remoteAddress || null;
    const userAgent = request.headers['user-agent'] || null;

    return next.handle().pipe(
      tap(async (response) => {
        if (auditMeta) {
          await this.logEvent(request, auditMeta, ip, userAgent, false, response);
        }
      }),
      catchError((error) => {
        if (auditMeta) {
          this.logEvent(request, auditMeta, ip, userAgent, true, error).catch(
            (err) => console.error('Failed to log audit event on error:', err),
          );
        }
        return throwError(() => error);
      }),
    );
  }

  private async logEvent(
    request: any,
    meta: AuditMetadataOptions,
    ip: string | null,
    userAgent: string | null,
    isFailed: boolean,
    resultOrError: any,
  ) {
    try {
      const user = request.user;

      // Extract details
      const actorId = user?.id || user?.sub || 'system';
      
      // Map actorType to enum values: USER, ADMIN, SYSTEM
      let actorType: ActorType = ActorType.SYSTEM;
      if (user) {
        const sysRole = user.systemRole;
        if (sysRole === 'SUPER_ADMIN' || sysRole === 'ORG_ADMIN' || sysRole === 'ADMIN') {
          actorType = ActorType.ADMIN;
        } else {
          actorType = ActorType.USER;
        }
      }

      const orgId =
        user?.organizationId ||
        user?.orgId ||
        request.params?.organizationId ||
        request.params?.orgId ||
        null;

      const userId = user?.id || user?.sub || request.params?.userId || null;

      // Determine resource ID (commonly ':id', ':userId', ':orgId' parameter)
      const resourceId =
        request.params?.id ||
        request.params?.userId ||
        request.params?.organizationId ||
        null;

      let action = meta.action;
      if (isFailed) {
        action = `${action}.failed`;
      }

      // Payload metadata construction
      const metadata = {
        path: request.path,
        method: request.method,
        query: request.query,
        params: request.params,
        body: this.sanitizeBody(request.body),
        ...(isFailed
          ? { error: resultOrError?.message || String(resultOrError) }
          : {}),
      };

      await this.auditService.log({
        organizationId: orgId,
        userId: userId,
        actorId: actorId,
        actorType: actorType === ActorType.ADMIN ? 'admin' : (actorType === ActorType.USER ? 'user' : 'system'),
        action: action,
        resourceType: meta.resourceType,
        resourceId: resourceId,
        metadata: metadata,
        ipAddress: ip ?? undefined,
        userAgent: userAgent ?? undefined,
      });
    } catch (err) {
      console.error('AuditInterceptor logEvent internal error:', err);
    }
  }

  private sanitizeBody(body: any) {
    if (!body) return {};
    const sanitized = { ...body };
    const sensitiveKeys = ['password', 'token', 'secret', 'passwordConfirmation', 'refreshToken'];
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '***';
      }
    }
    return sanitized;
  }
}
