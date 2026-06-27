import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../services/cache.service";
import { PlanType } from "@prisma/client";

@Injectable()
export class PlanGuard implements CanActivate {
  private readonly logger = new Logger(PlanGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path || request.url || "";
    const method = request.method || "";

    // ── 1. Resolve userId + orgId (Passport user or raw token decode) ───────
    let userId = request.user?.id;
    let orgId = request.user?.orgId;

    if (!userId) {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
          const decoded = this.jwtService.decode(token) as any;
          if (decoded?.sub) {
            userId = decoded.sub;
            orgId = decoded.orgId;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!userId) return true; // unauthenticated — let JwtAuthGuard reject

    // ── 2. Resolve plan (org-scoped > user-scoped > FREE fallback) ───────────
    const cacheKey = orgId ? `plan:org:${orgId}` : `plan:${userId}`;
    let cachedPlan = await this.cache.get<any>(cacheKey);

    if (!cachedPlan) {
      cachedPlan = await this.resolvePlan(userId, orgId);
      if (cachedPlan) {
        await this.cache.set(cacheKey, cachedPlan, 900); // 15 min TTL
      }
    }

    if (!cachedPlan) {
      this.logger.error("Plan configuration for FREE not found in database.");
      return true;
    }

    // ── 3. Token budget (chat / quiz / ai routes) ─────────────────────────
    const isTokenRoute =
      path.includes("/chat") || path.includes("/quiz") || path.includes("/ai");

    if (isTokenRoute) {
      const used = cachedPlan.currentPeriodTokensUsed ?? 0;
      const max = cachedPlan.limits?.maxTokensPerMonth ?? 50000;
      if (used >= max) {
        throw new ForbiddenException({
          code: "TOKEN_BUDGET_EXCEEDED",
          message: `Monthly token budget of ${max} tokens exceeded. Please upgrade your plan.`,
        });
      }
    }

    // ── 4. Feature gates (AI Tutor / Knowledge Graph → Pro+) ─────────────
    if (path.includes("/tutor") || path.includes("/graph")) {
      if (cachedPlan.type === PlanType.FREE) {
        throw new ForbiddenException({
          code: "FEATURE_GATED",
          message: "This feature requires a Pro or Premium subscription.",
        });
      }
    }

    // ── 5. Daily upload limit ─────────────────────────────────────────────
    const isUploadRoute =
      method === "POST" && path.includes("/documents/upload");

    if (isUploadRoute) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      // Aggregate uploads by org when orgId is available, else by user
      const uploadsCount = orgId
        ? await this.getOrgUploadCount(orgId, todayStart)
        : await this.getUserUploadCount(userId, todayStart);

      const maxUploads = cachedPlan.limits?.maxDocuments ?? 5;
      if (uploadsCount >= maxUploads) {
        throw new ForbiddenException({
          code: "UPLOAD_LIMIT_EXCEEDED",
          message: `Daily upload limit of ${maxUploads} exceeded. Upgrade your plan to increase this limit.`,
        });
      }
    }

    return true;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Plan resolution helpers
  // ────────────────────────────────────────────────────────────────────────

  private async resolvePlan(userId: string, orgId?: string) {
    // 1. Try org subscription first (org-scoped billing)
    if (orgId) {
      const orgSub = await this.prisma.subscription.findUnique({
        where: { organizationId: orgId },
        include: { plan: true },
      });

      if (orgSub?.plan) {
        return {
          id: orgSub.plan.id,
          name: orgSub.plan.name,
          type: orgSub.plan.type,
          limits: orgSub.plan.limits,
          maxUsers: orgSub.plan.maxUsers,
          currentPeriodTokensUsed: orgSub.currentPeriodTokensUsed ?? 0,
        };
      }
    }

    // 2. Fall back to user-scoped subscription (legacy / personal orgs)
    const userSub = await this.prisma.subscription.findFirst({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    const plan =
      userSub?.plan ||
      (await this.prisma.plan.findUnique({ where: { type: PlanType.FREE } }));

    if (!plan) return null;

    return {
      id: plan.id,
      name: plan.name,
      type: plan.type,
      limits: plan.limits,
      maxUsers: plan.maxUsers,
      currentPeriodTokensUsed: userSub?.currentPeriodTokensUsed ?? 0,
    };
  }

  private async getOrgUploadCount(orgId: string, since: Date): Promise<number> {
    const agg = await this.prisma.usageRecord.aggregate({
      where: { orgId, date: { gte: since } },
      _sum: { uploadsCount: true },
    });
    return agg._sum.uploadsCount ?? 0;
  }

  private async getUserUploadCount(userId: string, since: Date): Promise<number> {
    const record = await this.prisma.usageRecord.findFirst({
      where: { userId, date: { gte: since } },
    });
    return record?.uploadsCount ?? 0;
  }
}
