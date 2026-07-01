import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { AnalyticsService } from "../services/analytics.service";

export const TRACK_EVENT_KEY = "track_event_key";

/**
 * Custom decorator to automatically track request success telemetry.
 * TrackInterceptor is registered globally as APP_INTERCEPTOR in AppModule
 * and processes any route that has this metadata set.
 */
export const Track = (event: string) => SetMetadata(TRACK_EVENT_KEY, event);

@Injectable()
export class TrackInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TrackInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly analyticsService: AnalyticsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const event = this.reflector.get<string>(TRACK_EVENT_KEY, context.getHandler());
    if (!event) {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest();

    return next.handle().pipe(
      tap(() => {
        try {
          const user = request.user || {};
          const tenantId = request.tenantId || "default";
          const userId = user.id || request.body?.userId || null;
          const orgId = user.orgId || request.body?.orgId || request.headers["x-organization-id"] || null;
          const sessionId = request.body?.sessionId || request.query?.sessionId || null;

          // Filter out sensitive data from properties
          const properties = {
            ip: request.ip,
            method: request.method,
            url: request.url,
            pathParams: request.params,
            queryParams: request.query,
            body: this.sanitizeBody(request.body),
          };

          this.analyticsService.track({
            tenantId,
            orgId,
            userId,
            event,
            properties,
            sessionId,
          });
        } catch (err: any) {
          // Interceptor errors should not block client HTTP response
          this.logger.error(`TrackInterceptor failure for event "${event}": ${err.message}`);
        }
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== "object") return body;
    const sanitized = { ...body };
    const sensitiveKeys = ["password", "token", "secret", "apiKey", "passwordConfirmation", "oldPassword"];
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = "[REDACTED]";
      }
    }
    return sanitized;
  }
}
