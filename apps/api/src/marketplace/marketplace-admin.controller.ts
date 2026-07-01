import {
  Controller,
  Patch,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { IsString, IsNotEmpty } from "class-validator";

export class RejectListingDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

import { RequiresFeature } from "../common/guards/tenant-feature.guard";

@Controller("admin/marketplace")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@RequiresFeature("marketplace")
export class MarketplaceAdminController {
  private readonly logger = new Logger(MarketplaceAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * PATCH /admin/marketplace/:id/approve
   * Sets listing status to PUBLISHED and logs admin audit entry.
   */
  @Patch(":id/approve")
  async approveListing(@Param("id") id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: { creator: { select: { id: true, email: true, name: true } } },
    });

    if (!listing) {
      throw new NotFoundException(`Listing ${id} not found`);
    }

    if (listing.status !== "REVIEW") {
      throw new BadRequestException(
        `Only listings in REVIEW status can be approved. Current status: ${listing.status}`,
      );
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { status: "PUBLISHED" },
    });

    // Log admin approval to audit trail
    await this.auditService.log({
      actorType: "admin",
      action: "marketplace.listing.approved",
      resourceType: "Listing",
      resourceId: id,
      metadata: {
        listingTitle: listing.title,
        creatorId: listing.creatorId,
        creatorEmail: listing.creator.email,
      },
    });

    this.logger.log(
      `Admin approved listing "${listing.title}" (${id}) by creator ${listing.creator.email}`,
    );

    // Notify creator (Logger placeholder — replace with email queue job for production)
    this.logger.log(
      `[NOTIFY] Creator ${listing.creator.email}: Your listing "${listing.title}" has been APPROVED and is now live.`,
    );

    return updated;
  }

  /**
   * PATCH /admin/marketplace/:id/reject
   * Sets listing status to REJECTED with a reason and logs admin audit entry.
   */
  @Patch(":id/reject")
  async rejectListing(
    @Param("id") id: string,
    @Body() dto: RejectListingDto,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: { creator: { select: { id: true, email: true, name: true } } },
    });

    if (!listing) {
      throw new NotFoundException(`Listing ${id} not found`);
    }

    if (listing.status !== "REVIEW") {
      throw new BadRequestException(
        `Only listings in REVIEW status can be rejected. Current status: ${listing.status}`,
      );
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { status: "REJECTED" },
    });

    // Log admin rejection to audit trail
    await this.auditService.log({
      actorType: "admin",
      action: "marketplace.listing.rejected",
      resourceType: "Listing",
      resourceId: id,
      metadata: {
        listingTitle: listing.title,
        creatorId: listing.creatorId,
        creatorEmail: listing.creator.email,
        reason: dto.reason,
      },
    });

    this.logger.log(
      `Admin rejected listing "${listing.title}" (${id}) — Reason: ${dto.reason}`,
    );

    // Notify creator (Logger placeholder — replace with email queue job for production)
    this.logger.warn(
      `[NOTIFY] Creator ${listing.creator.email}: Your listing "${listing.title}" has been REJECTED. Reason: ${dto.reason}`,
    );

    return { ...updated, rejectionReason: dto.reason };
  }
}
