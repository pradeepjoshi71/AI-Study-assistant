import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  Param,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { CreateListingDto } from "./dto/create-listing.dto";
import { MarketplacePurchaseService } from "./marketplace-purchase.service";
import { MarketplaceService } from "./marketplace.service";
import { PlanType } from "@prisma/client";
import { IsInt, Min, Max, IsOptional, IsString } from "class-validator";

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

import { RequiresFeature } from "../common/guards/tenant-feature.guard";

@Controller("marketplace/listings")
@UseGuards(JwtAuthGuard)
@RequiresFeature("marketplace")
export class ListingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly purchaseService: MarketplacePurchaseService,
    private readonly marketplaceService: MarketplaceService,
    @InjectQueue("listing-moderation") private readonly moderationQueue: Queue,
  ) {}

  /**
   * POST /marketplace/listings
   * Creates a new Listing with status=DRAFT owned by the requesting user and their org.
   */
  @Post()
  async createListing(
    @CurrentUser() user: any,
    @Body() dto: CreateListingDto,
  ) {
    if (!user.organizationId) {
      throw new BadRequestException("User must belong to an organization to create listings");
    }

    const listing = await this.prisma.listing.create({
      data: {
        orgId: user.organizationId,
        creatorId: user.id,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        price: dto.price,
        status: "DRAFT",
        category: dto.category,
        tags: dto.tags,
        totalItems: dto.totalItems,
        previewItemCount: dto.previewItemCount ?? 3,
      },
    });

    return listing;
  }

  /**
   * POST /marketplace/listings/:id/publish
   * Enqueues a BullMQ moderation job for the listing.
   * Only the listing creator may publish.
   */
  @Post(":id/publish")
  async publishListing(
    @CurrentUser() user: any,
    @Param("id") id: string,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
    });

    if (!listing) {
      throw new NotFoundException(`Listing ${id} not found`);
    }

    if (listing.creatorId !== user.id) {
      throw new ForbiddenException("Only the listing creator can publish this listing");
    }

    if (listing.status !== "DRAFT" && listing.status !== "REJECTED") {
      throw new BadRequestException(
        `Listing cannot be published from status: ${listing.status}. Only DRAFT or REJECTED listings can be re-submitted.`,
      );
    }

    // Enqueue moderation job
    await this.moderationQueue.add(
      "moderate-listing",
      { listingId: id },
      { jobId: `moderate-${id}`, removeOnComplete: 50, removeOnFail: 20 },
    );

    return {
      message: "Listing submitted for moderation. You will be notified of the outcome.",
      listingId: id,
    };
  }

  /**
   * POST /marketplace/listings/:id/purchase
   * Pro+ plan required. Creates a Stripe PaymentIntent for purchasing this listing.
   * Returns { clientSecret, paymentIntentId } for the frontend to confirm payment.
   */
  @Post(":id/purchase")
  async purchaseListing(
    @CurrentUser() user: any,
    @Param("id") id: string,
  ) {
    // ── Inline Pro+ plan gate ─────────────────────────────────────────────
    if (!user.planType || user.planType === PlanType.FREE) {
      throw new ForbiddenException({
        code: "FEATURE_GATED",
        message: "Purchasing marketplace listings requires a Pro or Premium subscription.",
      });
    }

    try {
      return await this.purchaseService.createPaymentIntent(id, user.id);
    } catch (err: any) {
      if (err.message?.includes("already purchased")) {
        throw new ConflictException(err.message);
      }
      if (err.message?.includes("not found")) {
        throw new NotFoundException(err.message);
      }
      if (err.message?.includes("not available")) {
        throw new BadRequestException(err.message);
      }
      throw new BadRequestException(err.message ?? "Failed to create payment intent");
    }
  }

  /**
   * GET /marketplace/listings/:id
   * Detailed listing retrieval endpoint.
   * Returns listing, first previewItemCount items (full items list if purchased), and paginated reviews.
   */
  @Get(":id")
  async getListing(
    @CurrentUser() user: any,
    @Param("id") id: string,
    @Query("reviewLimit") reviewLimit?: string,
    @Query("reviewPage") reviewPage?: string,
  ) {
    const limit = reviewLimit ? parseInt(reviewLimit, 10) : 10;
    const page = reviewPage ? parseInt(reviewPage, 10) : 1;

    return this.marketplaceService.getListingDetails(id, user.id, limit, page);
  }

  /**
   * POST /marketplace/listings/:id/reviews
   * Submit a review for a listing. The user must have purchased the listing.
   */
  @Post(":id/reviews")
  async submitReview(
    @CurrentUser() user: any,
    @Param("id") id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.marketplaceService.createReview(id, user.id, dto.rating, dto.comment);
  }
}
