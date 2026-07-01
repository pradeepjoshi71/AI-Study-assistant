import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

class ReportDto {
  contentType!: string;
  reason?: string;
}

class AppealDto {
  reason!: string;
}

@Controller("moderation")
@UseGuards(JwtAuthGuard)
export class ModerationController {
  private readonly logger = new Logger(ModerationController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue("email") private readonly emailQueue: Queue,
  ) {}

  @Post("report/:contentId")
  async reportContent(
    @Req() req: any,
    @Param("contentId") contentId: string,
    @Body() dto: ReportDto,
  ) {
    const userId = req.user.id;
    const { contentType, reason } = dto;

    // ── 1. Redis Rate Limit: 10 reports per day per user ─────────────────────
    const today = new Date().toISOString().split("T")[0];
    const rateLimitKey = `user:report:count:${userId}:${today}`;
    const redisClient = this.redis.getClient();

    const currentCount = await redisClient.incr(rateLimitKey);
    if (currentCount === 1) {
      await redisClient.expire(rateLimitKey, 86400); // 24 hours TTL
    }

    if (currentCount > 10) {
      throw new HttpException(
        "Reporting limit of 10 reports per day exceeded",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── 2. Create ContentReport Record ───────────────────────────────────────
    // Resolve tenantId from content type
    let tenantId = "default";
    try {
      if (contentType === "document") {
        const doc = await this.prisma.document.findUnique({ where: { id: contentId } });
        if (doc?.orgId) {
          const org = await this.prisma.organization.findUnique({ where: { id: doc.orgId } });
          tenantId = org?.tenantId || "default";
        }
      } else if (contentType === "listing") {
        const listing = await this.prisma.listing.findUnique({
          where: { id: contentId },
          include: { organization: true },
        });
        tenantId = listing?.organization?.tenantId || "default";
      } else if (contentType === "message") {
        const msg = await this.prisma.message.findUnique({ where: { id: contentId } });
        tenantId = msg?.tenantId || "default";
      } else if (contentType === "group_message") {
        const gmsg = await this.prisma.groupMessage.findUnique({
          where: { id: contentId },
          include: { group: true },
        });
        if (gmsg?.group?.orgId) {
          const org = await this.prisma.organization.findUnique({ where: { id: gmsg.group.orgId } });
          tenantId = org?.tenantId || "default";
        }
      }
    } catch (err) {
      // fallback
    }

    const report = await this.prisma.contentReport.create({
      data: {
        tenantId,
        contentId,
        contentType,
        reason: reason || "No reason specified",
        reporterId: userId,
      },
    });

    // ── 3. Count reports for content; if >= 3, auto-flag content ──────────────
    const reportCount = await this.prisma.contentReport.count({
      where: { contentId },
    });

    if (reportCount >= 3) {
      this.logger.warn(`Content ${contentId} has accumulated ${reportCount} reports. Auto-flagging.`);
      try {
        const port = process.env.PORT || 3001;
        const callbackUrl = `http://localhost:${port}/api/v1/internal/moderation/verdict`;
        
        // Fetch/HTTP POST using native fetch in Node 18+
        await fetch(callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentId,
            contentType,
            verdict: false,
            scores: { reported: 1.0 },
            action: "FLAG",
          }),
        });
      } catch (err: any) {
        this.logger.error(`Failed triggering auto-flag verdict for reported content: ${err.message}`);
      }
    }

    return { success: true, reportId: report.id, currentReports: reportCount };
  }

  @Post("appeal/:contentId")
  async appealContent(
    @Req() req: any,
    @Param("contentId") contentId: string,
    @Body() dto: AppealDto,
  ) {
    const userId = req.user.id;
    const { reason } = dto;

    // Retrieve content type and tenant info for routing/notification
    let tenantId = "default";
    let contentType = "unknown";

    const doc = await this.prisma.document.findUnique({ where: { id: contentId } });
    if (doc) {
      contentType = "document";
      if (doc.orgId) {
        const org = await this.prisma.organization.findUnique({ where: { id: doc.orgId } });
        tenantId = org?.tenantId || "default";
      }
    }

    if (contentType === "unknown") {
      const listing = await this.prisma.listing.findUnique({
        where: { id: contentId },
        include: { organization: true },
      });
      if (listing) {
        contentType = "listing";
        tenantId = listing.organization.tenantId || "default";
      }
    }

    if (contentType === "unknown") {
      const msg = await this.prisma.message.findUnique({ where: { id: contentId } });
      if (msg) {
        contentType = "message";
        tenantId = msg.tenantId;
      }
    }

    if (contentType === "unknown") {
      const gmsg = await this.prisma.groupMessage.findUnique({
        where: { id: contentId },
        include: { group: true },
      });
      if (gmsg) {
        contentType = "group_message";
        if (gmsg.group.orgId) {
          const org = await this.prisma.organization.findUnique({ where: { id: gmsg.group.orgId } });
          tenantId = org?.tenantId || "default";
        }
      }
    }

    // ── 1. Create Appeal log in AdminAuditLog ────────────────────────────────
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: "system",
        action: "content.moderation.appeal_submitted",
        targetType: contentType,
        targetId: contentId,
        metadata: {
          appealReason: reason,
          userId,
          tenantId,
        },
      },
    });

    // ── 2. Get support/admin email to notify ─────────────────────────────────
    const tenantConfig = await this.prisma.tenantConfig.findUnique({
      where: { tenantId },
    });
    const adminEmail = tenantConfig?.supportEmail || "admin@studyapp.com";

    await this.emailQueue.add("send-email", {
      to: adminEmail,
      subject: `Content Moderation Appeal Submitted: ${contentId}`,
      body: `An appeal has been submitted by a user for content of type "${contentType}" (ID: ${contentId}).\n\nAppeal Reason: "${reason}"\n\nPlease resolve this review request in the moderation admin dashboard.`,
    });

    return { success: true, message: "Appeal submitted successfully" };
  }
}
