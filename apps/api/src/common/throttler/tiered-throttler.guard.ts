import { ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerStorage } from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { InjectThrottlerOptions, InjectThrottlerStorage } from "@nestjs/throttler";

@Injectable()
export class TieredThrottlerGuard extends ThrottlerGuard {
  private readonly tieredLogger = new Logger(TieredThrottlerGuard.name);

  constructor(
    @InjectThrottlerOptions() options: any,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Determine whether to skip rate limiting entirely for this route.
   * Rate limiting is only enforced on `/chat`, `/quiz`, `/upload`, and `/ai` routes.
   */
  override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const path = req.path || req.url || "";

    const isTargetRoute =
      path.startsWith("/chat") ||
      path.includes("/chat") ||
      path.startsWith("/quiz") ||
      path.includes("/quiz") ||
      path.includes("/study/quiz") ||
      path.startsWith("/upload") ||
      path.includes("/upload") ||
      path.includes("/documents/upload") ||
      path.startsWith("/ai") ||
      path.includes("/ai-os") ||
      path.includes("/ai/");

    return !isTargetRoute;
  }

  /**
   * Determine rate limit key using userId (sub) for authenticated requests,
   * falling back to the request IP address.
   */
  override async getTracker(req: any): Promise<string> {
    if (req.user && req.user.id) {
      return req.user.id;
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const decoded = this.jwtService.decode(token) as any;
        if (decoded && decoded.sub) {
          return decoded.sub;
        }
      } catch {
        // ignore decode errors
      }
    }

    return req.ip;
  }

  /**
   * Execute rate limiting check. Selects the throttler configured
   * for the user's specific tier (Free, Pro, Premium).
   */
  override async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: any,
    getTracker: any,
    generateKey: any,
  ): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const tier = this.extractTierFromRequest(req);

    // Only apply rate limiting if the current throttler config matches the user's tier.
    if (throttler.name !== tier) {
      return true;
    }

    return super.handleRequest(context, limit, ttl, throttler, getTracker, generateKey);
  }

  /**
   * Extract user tier from req.user (JWT payload decoded by Passport)
   * or manually from Bearer Token header if JwtAuthGuard hasn't run yet.
   */
  private extractTierFromRequest(req: any): string {
    if (req.user && req.user.tier) {
      return req.user.tier.toLowerCase();
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const decoded = this.jwtService.decode(token) as any;
        if (decoded && decoded.tier) {
          return decoded.tier.toLowerCase();
        }
      } catch {
        // ignore decode errors
      }
    }

    return "free";
  }
}
