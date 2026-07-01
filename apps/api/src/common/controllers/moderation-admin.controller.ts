import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";

class RuleDto {
  category!: string;
  threshold!: number;
  action!: string;
  tenantId?: string;
}

class ResolveDto {
  approved!: boolean;
}

@Controller("admin/moderation")
@UseGuards(JwtAuthGuard)
export class ModerationAdminController {
  private readonly logger = new Logger(ModerationAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─── Moderation Rules CRUD ──────────────────────────────────────────────────

  @Get("rules")
  async getRules(@Req() req: any, @Query("tenantId") tenantIdQuery?: string) {
    const user = req.user;
    if (user.systemRole !== "SUPER_ADMIN" && user.systemRole !== "ORG_ADMIN") {
      throw new ForbiddenException("Platform admin privileges required");
    }

    const tenantId =
      user.systemRole === "SUPER_ADMIN" && tenantIdQuery
        ? tenantIdQuery
        : req.tenantId || "default";

    return this.prisma.moderationRule.findMany({
      where: { tenantId },
      orderBy: { category: "asc" },
    });
  }

  @Post("rules")
  async createRule(@Req() req: any, @Body() dto: RuleDto) {
    const user = req.user;
    if (user.systemRole !== "SUPER_ADMIN" && user.systemRole !== "ORG_ADMIN") {
      throw new ForbiddenException("Platform admin privileges required");
    }

    const tenantId =
      user.systemRole === "SUPER_ADMIN" && dto.tenantId
        ? dto.tenantId
        : req.tenantId || "default";

    const rule = await this.prisma.moderationRule.upsert({
      where: {
        tenantId_category: {
          tenantId,
          category: dto.category,
        },
      },
      update: {
        threshold: dto.threshold,
        action: dto.action,
      },
      create: {
        tenantId,
        category: dto.category,
        threshold: dto.threshold,
        action: dto.action,
      },
    });

    // Flush Redis cache for rules
    await this.redis.getClient().del(`mod:rules:${tenantId}`);

    return rule;
  }

  @Put("rules/:id")
  async updateRule(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: Omit<RuleDto, "category">,
  ) {
    const user = req.user;
    if (user.systemRole !== "SUPER_ADMIN" && user.systemRole !== "ORG_ADMIN") {
      throw new ForbiddenException("Platform admin privileges required");
    }

    const rule = await this.prisma.moderationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("Moderation rule not found");

    if (user.systemRole === "ORG_ADMIN" && rule.tenantId !== req.tenantId) {
      throw new ForbiddenException("Access forbidden to this tenant's rules");
    }

    const updated = await this.prisma.moderationRule.update({
      where: { id },
      data: {
        threshold: dto.threshold,
        action: dto.action,
      },
    });

    await this.redis.getClient().del(`mod:rules:${rule.tenantId}`);

    return updated;
  }

  @Delete("rules/:id")
  async deleteRule(@Req() req: any, @Param("id") id: string) {
    const user = req.user;
    if (user.systemRole !== "SUPER_ADMIN" && user.systemRole !== "ORG_ADMIN") {
      throw new ForbiddenException("Platform admin privileges required");
    }

    const rule = await this.prisma.moderationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("Moderation rule not found");

    if (user.systemRole === "ORG_ADMIN" && rule.tenantId !== req.tenantId) {
      throw new ForbiddenException("Access forbidden to this tenant's rules");
    }

    await this.prisma.moderationRule.delete({ where: { id } });
    await this.redis.getClient().del(`mod:rules:${rule.tenantId}`);

    return { success: true };
  }

  // ─── Moderation Log Queue & Resolution ─────────────────────────────────────

  @Get()
  async getModerationQueue(@Req() req: any) {
    const user = req.user;
    if (user.systemRole !== "SUPER_ADMIN" && user.systemRole !== "ORG_ADMIN") {
      throw new ForbiddenException("Platform admin privileges required");
    }

    const tenantFilter =
      user.systemRole === "ORG_ADMIN"
        ? { tenantId: req.tenantId || "default" }
        : {};

    const logs = await this.prisma.moderationLog.findMany({
      where: {
        action: { in: ["FLAG", "BLOCK"] },
        resolvedAt: null,
        ...tenantFilter,
      },
      orderBy: { createdAt: "desc" },
    });

    // Enrich logs with actual content details for review
    const enriched = await Promise.all(
      logs.map(async (log) => {
        let contentSnippet = "Content not found or deleted";
        let ownerName = "Unknown";
        let ownerEmail = "";

        try {
          if (log.contentType === "document") {
            const doc = await this.prisma.document.findUnique({
              where: { id: log.contentId },
              include: { user: true },
            });
            if (doc) {
              contentSnippet = `Document Title: "${doc.title}" (Format: ${doc.fileType})`;
              ownerName = doc.user.name || doc.user.email;
              ownerEmail = doc.user.email;
            }
          } else if (log.contentType === "listing") {
            const listing = await this.prisma.listing.findUnique({
              where: { id: log.contentId },
              include: { creator: true },
            });
            if (listing) {
              contentSnippet = `Marketplace Listing: "${listing.title}" - ${listing.description.substring(0, 80)}...`;
              ownerName = listing.creator.name || listing.creator.email;
              ownerEmail = listing.creator.email;
            }
          } else if (log.contentType === "message") {
            const msg = await this.prisma.message.findUnique({
              where: { id: log.contentId },
              include: { conversation: { include: { user: true } } },
            });
            if (msg) {
              contentSnippet = `Chat Message: "${msg.content}"`;
              ownerName = msg.conversation.user.name || msg.conversation.user.email;
              ownerEmail = msg.conversation.user.email;
            }
          } else if (log.contentType === "group_message") {
            const gmsg = await this.prisma.groupMessage.findUnique({
              where: { id: log.contentId },
              include: { user: true },
            });
            if (gmsg) {
              contentSnippet = `Group Chat Message: "${gmsg.content}"`;
              ownerName = gmsg.user.name || gmsg.user.email;
              ownerEmail = gmsg.user.email;
            }
          }
        } catch (err) {
          // ignore error resolving log entity
        }

        return {
          ...log,
          contentSnippet,
          ownerName,
          ownerEmail,
        };
      }),
    );

    return enriched;
  }

  @Patch(":logId/resolve")
  async resolveLog(
    @Req() req: any,
    @Param("logId") logId: string,
    @Body() dto: ResolveDto,
  ) {
    const user = req.user;
    if (user.systemRole !== "SUPER_ADMIN" && user.systemRole !== "ORG_ADMIN") {
      throw new ForbiddenException("Platform admin privileges required");
    }

    const log = await this.prisma.moderationLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException("Moderation log not found");

    if (user.systemRole === "ORG_ADMIN" && log.tenantId !== req.tenantId) {
      throw new ForbiddenException("Access forbidden to this tenant's logs");
    }

    const { approved } = dto;

    // ── 1. Update ModerationLog ──────────────────────────────────────────────
    const updatedLog = await this.prisma.moderationLog.update({
      where: { id: logId },
      data: {
        resolvedAt: new Date(),
        reviewedBy: user.id,
        resolved: approved,
      },
    });

    // ── 2. If approved, restore content to active state ──────────────────────
    if (approved) {
      try {
        if (log.contentType === "document") {
          await this.prisma.document.update({
            where: { id: log.contentId },
            data: { status: "READY" as any },
          });
        } else if (log.contentType === "listing") {
          await this.prisma.listing.update({
            where: { id: log.contentId },
            data: { status: "PUBLISHED" as any },
          });
        } else if (log.contentType === "message") {
          await this.prisma.message.update({
            where: { id: log.contentId },
            data: { status: "ACTIVE" },
          });
        } else if (log.contentType === "group_message") {
          await this.prisma.groupMessage.update({
            where: { id: log.contentId },
            data: { status: "ACTIVE" },
          });
        }
        this.logger.log(`Content ${log.contentId} (${log.contentType}) restored by admin approval.`);
      } catch (err: any) {
        this.logger.error(`Failed to restore content status: ${err.message}`);
      }
    } else {
      this.logger.log(`Content ${log.contentId} (${log.contentType}) block confirmed by admin.`);
    }

    return updatedLog;
  }
}
