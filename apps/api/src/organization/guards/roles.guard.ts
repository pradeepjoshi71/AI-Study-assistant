import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { OrgMemberRole } from "@prisma/client";
import { CacheService } from "../../common/services/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ROLES_KEY } from "../decorators/roles.decorator";

/** Redis key TTL for the cached role value (10 minutes) */
const ROLE_CACHE_TTL_SECONDS = 600;

/** Numeric weight per role — higher = more privileges */
const ROLE_WEIGHT: Record<OrgMemberRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

/**
 * Permission matrix — what each role is DENIED from doing.
 *
 * The guard reads the required roles from @Roles() metadata:
 *  - OWNER:  full access (no restrictions)
 *  - ADMIN:  no access to billing routes
 *  - MEMBER: no access to member-management routes or billing routes
 *  - VIEWER: read-only (GET only)
 */
const ROUTE_PERMISSIONS: {
  /** Path substring or regex to match */
  pattern: RegExp | string;
  method?: string;
  /** Minimum role required to call this route */
  minRole: OrgMemberRole;
  /** Human-readable reason sent in the 403 body */
  reason: string;
}[] = [
  // ── Billing routes ────────────────────────────────────────────────
  {
    pattern: /\/billing/,
    minRole: "OWNER",
    reason: "Only OWNERs can manage billing. ADMINs, MEMBERs and VIEWERs have no billing access.",
  },
  // ── Member management routes ──────────────────────────────────────
  {
    pattern: /\/organizations\/[^/]+\/invite/,
    minRole: "ADMIN",
    reason: "Only OWNERs and ADMINs can invite members.",
  },
  {
    pattern: /\/organizations\/[^/]+\/members\/[^/]+/,
    method: "PATCH",
    minRole: "ADMIN",
    reason: "Only OWNERs and ADMINs can update member roles.",
  },
  {
    pattern: /\/organizations\/[^/]+\/members\/[^/]+/,
    method: "DELETE",
    minRole: "ADMIN",
    reason:
      "Only OWNERs and ADMINs can remove members (MEMBERs may remove themselves via self-removal).",
  },
  // ── Organization mutation routes ──────────────────────────────────
  {
    pattern: /\/organizations\/[^/]+$/,
    method: "PATCH",
    minRole: "ADMIN",
    reason: "Only OWNERs and ADMINs can edit organization settings.",
  },
  {
    pattern: /\/organizations\/[^/]+$/,
    method: "DELETE",
    minRole: "OWNER",
    reason: "Only the OWNER can delete an organization.",
  },
  // ── Viewer restriction — all mutating methods require MEMBER+ ─────
  {
    pattern: /\/organizations/,
    method: "POST",
    minRole: "MEMBER",
    reason: "VIEWERs have read-only access and cannot perform write operations.",
  },
  {
    pattern: /\/organizations/,
    method: "PATCH",
    minRole: "MEMBER",
    reason: "VIEWERs have read-only access and cannot perform write operations.",
  },
  {
    pattern: /\/organizations/,
    method: "DELETE",
    minRole: "MEMBER",
    reason: "VIEWERs have read-only access and cannot perform write operations.",
  },
];

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path: string = request.path || request.url || "";
    const method: string = (request.method || "GET").toUpperCase();

    // ── 1. Resolve orgId from JWT payload (set by JwtStrategy/middleware) ──
    const orgId: string | undefined =
      request.user?.orgId ||
      (request.user as any)?.currentOrgId;

    // If there's no orgId context, skip role enforcement
    // (e.g. personal-only routes or public endpoints)
    if (!orgId) {
      return true;
    }

    const userId: string | undefined = request.user?.id;
    if (!userId) {
      return true; // Let JwtAuthGuard handle the 401
    }

    // ── 2. Resolve the caller's role (Redis-first, DB fallback) ───────────
    const role = await this.resolveRole(orgId, userId);

    // Attach to request for downstream use
    (request as any).orgRole = role;

    // ── 3. Check explicit @Roles() metadata first ──────────────────────────
    const requiredRoles = this.reflector.getAllAndOverride<OrgMemberRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.some(
        (r) => ROLE_WEIGHT[role] >= ROLE_WEIGHT[r],
      );
      if (!hasRole) {
        const required = requiredRoles.map((r) => r).join(" or ");
        throw new ForbiddenException({
          code: "INSUFFICIENT_ROLE",
          message: `This action requires ${required} role. Your current role is ${role}.`,
          currentRole: role,
          requiredRoles,
        });
      }
      return true; // explicit @Roles() satisfied — skip matrix
    }

    // ── 4. Apply permission matrix ─────────────────────────────────────────
    for (const rule of ROUTE_PERMISSIONS) {
      const pathMatch =
        typeof rule.pattern === "string"
          ? path.includes(rule.pattern)
          : rule.pattern.test(path);

      if (!pathMatch) continue;
      if (rule.method && rule.method !== method) continue;

      if (ROLE_WEIGHT[role] < ROLE_WEIGHT[rule.minRole]) {
        this.logger.warn(
          `Role check failed: userId=${userId} role=${role} path=${method} ${path}`,
        );
        throw new ForbiddenException({
          code: "INSUFFICIENT_ROLE",
          message: rule.reason,
          currentRole: role,
          requiredRole: rule.minRole,
        });
      }

      // First matching rule that passes — allow (rules are ordered most-specific first)
      break;
    }

    return true;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Role resolution helpers
  // ────────────────────────────────────────────────────────────────────────

  private async resolveRole(orgId: string, userId: string): Promise<OrgMemberRole> {
    const cacheKey = `role:${orgId}:${userId}`;

    // Try Redis first
    const cached = await this.cache.get<OrgMemberRole>(cacheKey);
    if (cached) {
      this.logger.debug(`Role cache HIT: ${cacheKey} => ${cached}`);
      return cached;
    }

    // DB fallback
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true },
    });

    if (!membership) {
      // Not a member of this org — treat as effectively no access
      // but throw gracefully rather than silently allowing
      throw new ForbiddenException({
        code: "NOT_ORG_MEMBER",
        message: "You are not a member of this organization.",
        orgId,
      });
    }

    const role = membership.role;

    // Warm the cache
    await this.cache.set(cacheKey, role, ROLE_CACHE_TTL_SECONDS);
    this.logger.debug(`Role cache MISS (warmed): ${cacheKey} => ${role}`);

    return role;
  }
}
