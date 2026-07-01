import { Controller, Post, Body, Logger, HttpCode, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

interface VerdictDto {
  contentId: string;
  contentType: string;
  verdict: boolean;
  scores: Record<string, number>;
  action: string;
}

@Controller("internal/moderation")
export class InternalModerationController {
  private readonly logger = new Logger(InternalModerationController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @InjectQueue("email") private readonly emailQueue: Queue,
  ) {}

  @Post("verdict")
  @HttpCode(HttpStatus.OK)
  async handleVerdict(@Body() dto: VerdictDto) {
    const { contentId, contentType, verdict, scores, action } = dto;
    this.logger.log(`Received moderation verdict for contentId ${contentId} (${contentType}): Action=${action}`);

    let tenantId = "default";
    let orgId: string | null = null;
    let userId: string | null = null;

    // ── 1. Resolve content details and metadata ──────────────────────────────
    try {
      if (contentType === "document") {
        const doc = await this.prisma.document.findUnique({
          where: { id: contentId },
        });
        if (doc) {
          orgId = doc.orgId;
          userId = doc.userId;
          // Resolve tenantId from organization or user
          if (doc.orgId) {
            const org = await this.prisma.organization.findUnique({
              where: { id: doc.orgId },
            });
            tenantId = org?.tenantId || "default";
          }
        }
      } else if (contentType === "listing") {
        const listing = await this.prisma.listing.findUnique({
          where: { id: contentId },
          include: { organization: true },
        });
        if (listing) {
          orgId = listing.orgId;
          userId = listing.creatorId;
          tenantId = listing.organization.tenantId || "default";
        }
      } else if (contentType === "message") {
        const msg = await this.prisma.message.findUnique({
          where: { id: contentId },
          include: { conversation: true },
        });
        if (msg) {
          tenantId = msg.tenantId;
          userId = msg.conversation.userId;
        }
      } else if (contentType === "group_message") {
        const gmsg = await this.prisma.groupMessage.findUnique({
          where: { id: contentId },
          include: { group: true },
        });
        if (gmsg) {
          orgId = gmsg.group.orgId;
          userId = gmsg.userId;
          if (gmsg.group.orgId) {
            const org = await this.prisma.organization.findUnique({
              where: { id: gmsg.group.orgId },
            });
            tenantId = org?.tenantId || "default";
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error resolving content metadata: ${err.message}`);
    }

    // ── 2. Create ModerationLog ──────────────────────────────────────────────
    try {
      await this.prisma.moderationLog.create({
        data: {
          tenantId,
          orgId,
          contentId,
          contentType,
          verdict,
          scores: scores || {},
          action,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed writing ModerationLog: ${err.message}`);
    }

    // ── 3. Apply Enforcement Action (BLOCK / FLAG) ───────────────────────────
    if (action === "BLOCK") {
      try {
        if (contentType === "document") {
          await this.prisma.document.update({
            where: { id: contentId },
            data: { status: "HIDDEN" as any },
          });
        } else if (contentType === "listing") {
          await this.prisma.listing.update({
            where: { id: contentId },
            data: { status: "HIDDEN" as any },
          });
        } else if (contentType === "message") {
          await this.prisma.message.update({
            where: { id: contentId },
            data: { status: "HIDDEN" },
          });
        } else if (contentType === "group_message") {
          await this.prisma.groupMessage.update({
            where: { id: contentId },
            data: { status: "HIDDEN" },
          });
        }
        this.logger.warn(`Content ${contentId} of type ${contentType} has been HIDDEN due to BLOCK verdict`);
      } catch (err: any) {
        this.logger.error(`Failed setting content status to HIDDEN: ${err.message}`);
      }
    } else if (action === "FLAG") {
      try {
        // Create admin review queue entry via AuditLog (Phase 4.2 pattern)
        await this.auditService.log({
          actorType: "system",
          action: `${contentType.toLowerCase()}.moderation.flagged`,
          resourceType: contentType,
          resourceId: contentId,
          metadata: {
            verdict,
            scores,
            action,
            aiReason: "Automated thresholds exceeded",
          },
        });
        this.logger.log(`Admin queue entry logged for flagged content: ${contentId}`);
      } catch (err: any) {
        this.logger.error(`Failed creating audit log moderation queue entry: ${err.message}`);
      }
    }

    // ── 4. Dispatch Owner Notification Job ───────────────────────────────────
    if ((action === "BLOCK" || action === "FLAG") && userId) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });

        if (user && user.email) {
          const category = Object.entries(scores || {})
            .filter(([_, score]) => score > 0.1)
            .map(([cat]) => cat)
            .join(", ") || "automated rule match";

          await this.emailQueue.add("send-email", {
            to: user.email,
            subject: `Content Moderation Enforcement: ${action}`,
            body: `Hello ${user.name || "User"},\n\nOur systems flagged your content (${contentType}) for violating platform moderation standards.\n\nTriggered Category: ${category}\nEnforcement Action: ${action}\n\nTo view details or submit an appeal request, please visit:\nhttps://studyapp.com/appeals?contentId=${contentId}&type=${contentType}`,
          });

          this.logger.log(`Moderation notification email queued for user: ${user.email}`);
        }
      } catch (err: any) {
        this.logger.error(`Failed dispatching email warning notification: ${err.message}`);
      }
    }

    return { success: true };
  }
}
