import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    
    // Check if the request path falls under /api/admin or /admin
    const path = request.path || '';
    if (!path.startsWith('/api/admin') && !path.startsWith('/admin')) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async () => {
        try {
          const user = request.user;
          if (!user) return; // Skip if no authenticated user context

          const adminId = user.id;
          const action = `${request.method} ${path}`;
          const ip = request.ip || request.connection?.remoteAddress || null;
          const userAgent = request.headers['user-agent'] || null;

          let targetType = 'unknown';
          let targetId: string | null = null;
          const params = request.params || {};

          if (params.organizationId) {
            targetId = params.organizationId;
            targetType = 'organization';
          } else if (params.userId) {
            targetId = params.userId;
            targetType = 'user';
          } else if (params.id) {
            targetId = params.id;
            if (path.includes('/organizations/')) {
              targetType = 'organization';
            } else if (path.includes('/users/')) {
              targetType = 'user';
            } else {
              targetType = 'resource';
            }
          } else {
            const keys = Object.keys(params);
            if (keys.length > 0) {
              targetId = params[keys[0]];
              targetType = keys[0].replace('Id', '');
            }
          }

          // Extract request body/query metadata for auditing
          const metadata = {
            body: request.body,
            query: request.query,
          };

          await this.prisma.adminAuditLog.create({
            data: {
              adminId,
              action,
              targetType,
              targetId,
              metadata: metadata as any,
              ip,
              userAgent,
            },
          });
        } catch (err) {
          // Non-blocking log write failure to prevent crashing user response
          console.error('Failed to write AdminAuditLog:', err);
        }
      }),
    );
  }
}
