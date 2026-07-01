import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tenantContextStorage } from "../context/tenant-context";

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (!request) {
      return next.handle();
    }

    const path = request.path || request.url || "";

    // ── Exclude auth and public tenant-config endpoints ──────────────────────
    if (path.includes("/auth") || path.includes("/tenant-config")) {
      return next.handle();
    }

    const tenantId = request.tenantId;

    if (tenantId) {
      // Propagate tenantId context using AsyncLocalStorage
      return new Observable((observer) => {
        tenantContextStorage.run({ tenantId }, () => {
          const subscription = next.handle().subscribe({
            next: (val) => observer.next(val),
            error: (err) => observer.error(err),
            complete: () => observer.complete(),
          });
          return () => subscription.unsubscribe();
        });
      });
    }

    return next.handle();
  }
}
