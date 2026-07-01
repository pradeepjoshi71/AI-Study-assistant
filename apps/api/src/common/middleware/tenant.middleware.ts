import {
  Injectable,
  NestMiddleware,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../services/cache.service";

interface TenantCachePayload {
  tenantId: string;
  status: string;
  planId: string;
  features: any;
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = req.path || req.url || "";

    // ── Exclude auth, public tenant-config, and internal microservice endpoints ──
    if (path.includes("/auth") || path.includes("/tenant-config") || path.includes("/internal/")) {
      return next();
    }

    const hostHeader = req.headers.host || "";
    const host = hostHeader.split(":")[0].toLowerCase(); // strip port

    let tenantData: TenantCachePayload | null = null;

    // ── 1. Resolve via Custom Domain ─────────────────────────────────────────
    // Assume if the host is not a subdomain of the platform (e.g. acme.com vs acme.localhost),
    // it could be a custom domain. We check domain cache and DB.
    const customDomainKey = `tenant:domain:${host}`;
    const cachedDomainData = await this.cache.get<TenantCachePayload>(customDomainKey);

    if (cachedDomainData) {
      tenantData = cachedDomainData;
    } else {
      // Query database for custom domain match
      const dbTenantByDomain = await this.prisma.tenant.findFirst({
        where: { customDomain: host },
        include: { config: true },
      });

      if (dbTenantByDomain) {
        tenantData = {
          tenantId: dbTenantByDomain.id,
          status: dbTenantByDomain.status,
          planId: dbTenantByDomain.planId,
          features: dbTenantByDomain.config?.features || {},
        };
        // Cache domain config for 5 minutes (300 seconds)
        await this.cache.set(customDomainKey, tenantData, 300);
      }
    }

    // ── 2. Fall back to Subdomain ────────────────────────────────────────────
    if (!tenantData) {
      // Extract subdomain: split on first dot (e.g., acme.localhost:3000 -> acme)
      const parts = host.split(".");
      const subdomain = parts.length > 1 ? parts[0] : host; // fallback to host if no dot

      const subdomainKey = `tenant:sub:${subdomain}`;
      const cachedSubdomainData = await this.cache.get<TenantCachePayload>(subdomainKey);

      if (cachedSubdomainData) {
        tenantData = cachedSubdomainData;
      } else {
        // Query database for subdomain match
        const dbTenantBySubdomain = await this.prisma.tenant.findFirst({
          where: { subdomain },
          include: { config: true },
        });

        if (dbTenantBySubdomain) {
          tenantData = {
            tenantId: dbTenantBySubdomain.id,
            status: dbTenantBySubdomain.status,
            planId: dbTenantBySubdomain.planId,
            features: dbTenantBySubdomain.config?.features || {},
          };
          // Cache subdomain config for 5 minutes (300 seconds)
          await this.cache.set(subdomainKey, tenantData, 300);
        }
      }
    }

    // ── 3. Handle Exceptions & Request Context Binding ───────────────────────
    if (!tenantData) {
      this.logger.warn(`Tenant resolution failed for host: "${host}"`);
      throw new NotFoundException(`Tenant not found for host: ${host}`);
    }

    if (tenantData.status === "SUSPENDED") {
      this.logger.warn(`Access blocked: Tenant ${tenantData.tenantId} is SUSPENDED`);
      throw new ForbiddenException("Tenant account is suspended");
    }

    // Attach tenantId and config features to request context
    (req as any).tenantId = tenantData.tenantId;
    (req as any).tenantFeatures = tenantData.features;

    next();
  }
}
