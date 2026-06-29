import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import * as crypto from "crypto";

@Injectable()
export class CacheHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const url = request.url || "";
    const method = request.method;

    // Apply only to GET /mobile/* endpoints
    if (method !== "GET" || !url.includes("/mobile/")) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // 1. Determine Cache-Control max-age (N seconds) based on route match
        let maxAge = 0;
        if (url.includes("/mobile/docs")) {
          maxAge = 300;
        } else if (url.includes("/mobile/flashcards")) {
          maxAge = 3600;
        } else if (url.includes("/mobile/progress")) {
          maxAge = 600;
        }

        if (maxAge > 0) {
          response.setHeader("Cache-Control", `private, max-age=${maxAge}`);
        }

        // 2. Add Last-Modified header if resource has updatedAt property
        let lastUpdated: Date | null = null;
        if (data && typeof data === "object") {
          // If response is nested inside mobile wrapper interceptor
          const targetObj = data.data ?? data;
          if (targetObj.updatedAt) {
            lastUpdated = new Date(targetObj.updatedAt);
          } else if (Array.isArray(targetObj) && targetObj.length > 0) {
            // Find most recent update inside array lists
            const dates = targetObj
              .map((item: any) => item.updatedAt ? new Date(item.updatedAt).getTime() : 0)
              .filter(Boolean);
            if (dates.length > 0) {
              lastUpdated = new Date(Math.max(...dates));
            }
          }
        }

        if (lastUpdated && !isNaN(lastUpdated.getTime())) {
          response.setHeader("Last-Modified", lastUpdated.toUTCString());
        }

        // 3. Generate ETag from SHA256 of response body
        const bodyString = JSON.stringify(data || {});
        const etag = `W/"${crypto.createHash("sha256").update(bodyString).digest("hex")}"`;
        response.setHeader("ETag", etag);

        // 4. Handle ETag Cache Hits (If-None-Match header matching ETag)
        const ifNoneMatch = request.headers["if-none-match"];
        if (ifNoneMatch === etag) {
          response.status(304);
          return null; // Return empty body
        }

        return data;
      }),
    );
  }
}
