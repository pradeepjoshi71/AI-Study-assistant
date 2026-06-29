import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

@Injectable()
export class MobileInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const url = request.url || "";

    return next.handle().pipe(
      map((data) => {
        // Only wrap response if the path contains /mobile/
        if (url.includes("/mobile/")) {
          // If the data is already formatted or an error, return as is
          if (data && typeof data === "object" && ("version" in data || "error" in data)) {
            return data;
          }

          // Extract meta properties if passed in response root, otherwise default
          const page = data?.meta?.page ?? undefined;
          const cursor = data?.meta?.cursor ?? data?.cursor ?? undefined;
          const total = data?.meta?.total ?? undefined;

          // Strip meta/cursor keys from data root to avoid duplicates
          const cleanedData = { ...data };
          if (cleanedData.meta) delete cleanedData.meta;
          if (cleanedData.cursor) delete cleanedData.cursor;

          return {
            version: "1.0",
            data: cleanedData.data ?? cleanedData,
            meta: {
              page,
              cursor,
              total,
            },
            error: null,
          };
        }

        return data;
      }),
    );
  }
}
