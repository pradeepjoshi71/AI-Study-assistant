import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PluginRuntimeService } from '../plugin-runtime/plugin-runtime.service';
import { PluginInstall, ListingType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../common/services/cache.service';
import { MarketplacePurchaseService } from './marketplace-purchase.service';
import { createHash } from 'crypto';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginRuntime: PluginRuntimeService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly purchaseService: MarketplacePurchaseService,
  ) {
    this.aiServiceUrl = this.config.get<string>('NEXT_PUBLIC_AI_SERVICE_URL', 'http://localhost:8000');
  }

  async installPlugin(params: {
    organizationId: string;
    pluginId: string;
    installedById: string;
    config?: any;
  }): Promise<PluginInstall> {
    const { organizationId, pluginId, installedById, config } = params;

    // Verify plugin exists
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
    });
    if (!plugin || !plugin.isActive) {
      throw new NotFoundException('Plugin not found or is inactive');
    }

    // Check if already installed
    const existing = await this.prisma.pluginInstall.findUnique({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
    });
    if (existing) {
      throw new ConflictException('Plugin is already installed in this organization');
    }

    return this.prisma.pluginInstall.create({
      data: {
        organizationId,
        pluginId,
        installedById,
        config: config ?? {},
      },
      include: { plugin: true },
    });
  }

  async uninstallPlugin(organizationId: string, pluginId: string): Promise<void> {
    const existing = await this.prisma.pluginInstall.findUnique({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
    });
    if (!existing) {
      throw new NotFoundException('Plugin installation not found');
    }

    await this.prisma.pluginInstall.delete({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
    });
  }

  async getInstalledPlugins(organizationId: string): Promise<any[]> {
    const installs = await this.prisma.pluginInstall.findMany({
      where: { organizationId },
      include: { plugin: true },
    });
    return installs.map((inst) => ({
      ...inst.plugin,
      installedAt: inst.createdAt,
      config: inst.config,
    }));
  }

  async ratePlugin(params: {
    pluginId: string;
    userId: string;
    rating: number;
    review?: string;
  }) {
    const { pluginId, userId, rating, review } = params;
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    return this.prisma.pluginRating.upsert({
      where: {
        pluginId_userId: { pluginId, userId },
      },
      update: { rating, review },
      create: { pluginId, userId, rating, review },
    });
  }

  async executeInstalledPlugin(params: {
    organizationId: string;
    pluginId: string;
    userId: string;
    inputData: Record<string, any>;
    conversationId?: string;
    userEmail?: string;
  }): Promise<any> {
    const { organizationId, pluginId, userId, inputData, conversationId, userEmail } = params;

    // Verify plugin is installed
    const install = await this.prisma.pluginInstall.findUnique({
      where: {
        organizationId_pluginId: { organizationId, pluginId },
      },
      include: { plugin: true },
    });

    if (!install) {
      throw new BadRequestException('Plugin is not installed in this organization');
    }

    // Merge installation config into inputData so that the plugin execution has credentials (e.g. API keys)
    const mergedInputData = {
      ...inputData,
      _config: install.config || {},
    };

    const userContext = {
      userId,
      email: userEmail,
      organizationId,
    };

    return this.pluginRuntime.executePlugin({
      plugin: install.plugin,
      inputData: mergedInputData,
      organizationId,
      userId,
      conversationId,
      userContext,
    });
  }

  // ── Helper Cursor Functions ────────────────────────────────────────────────

  private encodeMarketplaceCursor(id: string, score: number): string {
    const payload = `${id}:${score}`;
    return Buffer.from(payload, 'utf-8').toString('base64');
  }

  private decodeMarketplaceCursor(cursor: string): { id: string; score: number } | null {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length < 2) return null;
      const id = parts[0];
      const score = parseFloat(parts[1]);
      if (isNaN(score)) return null;
      return { id, score };
    } catch {
      return null;
    }
  }

  // ── GET /marketplace ────────────────────────────────────────────────────────

  async getListings(
    filters: {
      type?: ListingType;
      category?: string;
      priceMin?: number;
      priceMax?: number;
      ratingMin?: number;
    },
    pagination: {
      limit: number;
      cursor?: string;
    },
  ) {
    const { type, category, priceMin, priceMax, ratingMin } = filters;
    const { limit, cursor } = pagination;

    // Fetch all PUBLISHED listings that match simple filters
    const allListings = await this.prisma.listing.findMany({
      where: {
        status: 'PUBLISHED',
        type: type ?? undefined,
        category: category ?? undefined,
        price: {
          gte: priceMin ?? undefined,
          lte: priceMax ?? undefined,
        },
        rating: {
          gte: ratingMin ?? undefined,
        },
      },
    });

    // Compute score for each listing: salesCount * 0.6 + rating * 0.4
    const scoredListings = allListings.map((listing) => ({
      ...listing,
      score: listing.salesCount * 0.6 + listing.rating * 0.4,
    }));

    // Sort by score desc, tie-breaker id desc
    scoredListings.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.id.localeCompare(a.id);
    });

    // Apply cursor pagination
    let startIndex = 0;
    if (cursor) {
      const decoded = this.decodeMarketplaceCursor(cursor);
      if (decoded) {
        const foundIdx = scoredListings.findIndex((l) => l.id === decoded.id);
        if (foundIdx !== -1) {
          startIndex = foundIdx + 1;
        }
      }
    }

    const items = scoredListings.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < scoredListings.length;
    const nextCursor =
      hasMore && items.length > 0
        ? this.encodeMarketplaceCursor(items[items.length - 1].id, items[items.length - 1].score)
        : null;

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  // ── GET /marketplace/search?q= ──────────────────────────────────────────────

  async searchListings(query: string) {
    const q = (query || '').trim();
    if (!q) {
      return [];
    }

    const hash = createHash('sha256').update(q).digest('hex');
    const cacheKey = `search:${hash}`;

    // 1. Check Redis cache
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) {
      this.logger.log(`Search cache hit for query: "${q}"`);
      return cached;
    }

    this.logger.log(`Search cache miss for query: "${q}". Initiating vector search...`);

    try {
      // 2. Embed query via FastAPI /ai/embeddings
      const embedRes = await fetch(`${this.aiServiceUrl}/ai/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q }),
      });

      if (!embedRes.ok) {
        const errText = await embedRes.text();
        throw new Error(`FastAPI embedding failed: ${embedRes.status} - ${errText}`);
      }

      const { embedding } = await embedRes.json();
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding vector returned from FastAPI');
      }

      // 3. Qdrant search collection 'marketplace' top 10
      const qdrantHost = this.config.get<string>('QDRANT_HOST', 'localhost');
      const qdrantPort = this.config.get<string>('QDRANT_PORT', '6333');
      const qdrantSearchUrl = `http://${qdrantHost}:${qdrantPort}/collections/marketplace/points/search`;

      const qdrantRes = await fetch(qdrantSearchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vector: embedding,
          limit: 10,
          with_payload: true,
        }),
      });

      if (!qdrantRes.ok) {
        const errText = await qdrantRes.text();
        throw new Error(`Qdrant search failed: ${qdrantRes.status} - ${errText}`);
      }

      const qdrantBody = await qdrantRes.json();
      const hits = qdrantBody.result || [];

      // Extract listing IDs preserving Qdrant search order
      const listingIds: string[] = [];
      const seenIds = new Set<string>();
      for (const hit of hits) {
        const listingId = hit.payload?.listingId;
        if (listingId && !seenIds.has(listingId)) {
          seenIds.add(listingId);
          listingIds.push(listingId);
        }
      }

      if (listingIds.length === 0) {
        await this.cache.set(cacheKey, [], 300); // cache empty result for 5 mins
        return [];
      }

      // 4. Enrich with Listing metadata from Prisma
      const listings = await this.prisma.listing.findMany({
        where: {
          id: { in: listingIds },
          status: 'PUBLISHED',
        },
      });

      const listingsMap = new Map(listings.map((l) => [l.id, l]));
      const enriched = listingIds
        .map((id) => listingsMap.get(id))
        .filter((l): l is NonNullable<typeof l> => l !== undefined);

      // 5. Cache and return
      await this.cache.set(cacheKey, enriched, 300); // 5 mins TTL
      return enriched;
    } catch (err: any) {
      this.logger.error(`Marketplace vector search failed: ${err.message}`);
      // Fallback: simple Prisma text search if services are unavailable
      const fallbackListings = await this.prisma.listing.findMany({
        where: {
          status: 'PUBLISHED',
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 10,
      });
      return fallbackListings;
    }
  }

  // ── GET /marketplace/listings/:id ──────────────────────────────────────────

  async getListingDetails(
    id: string,
    userId: string,
    reviewLimit = 10,
    reviewPage = 1,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!listing) {
      throw new NotFoundException(`Listing ${id} not found`);
    }

    // Determine lock/unlock based on purchase status
    const hasBought = await this.purchaseService.hasPurchased(userId, id);

    // Fetch listing items. If purchased, fetch ALL. If not, only first previewItemCount.
    const items = await this.prisma.listingItem.findMany({
      where: { listingId: id },
      orderBy: { orderIndex: 'asc' },
      take: hasBought ? undefined : listing.previewItemCount,
    });

    // Fetch paginated reviews
    const skipReviews = (reviewPage - 1) * reviewLimit;
    const [reviews, totalReviews] = await Promise.all([
      this.prisma.listingReview.findMany({
        where: { listingId: id },
        orderBy: { createdAt: 'desc' },
        skip: skipReviews,
        take: reviewLimit,
        include: {
          user: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.listingReview.count({
        where: { listingId: id },
      }),
    ]);

    return {
      listing,
      hasPurchased: hasBought,
      items,
      reviews: {
        data: reviews,
        meta: {
          total: totalReviews,
          page: reviewPage,
          limit: reviewLimit,
          totalPages: Math.ceil(totalReviews / reviewLimit),
        },
      },
    };
  }

  // ── Submit Review ──────────────────────────────────────────────────────────

  async createReview(
    listingId: string,
    userId: string,
    rating: number,
    comment?: string,
  ) {
    // 1. Verify Purchase exists for userId+listingId (401 if not)
    const hasBought = await this.purchaseService.hasPurchased(userId, listingId);
    if (!hasBought) {
      throw new UnauthorizedException('You must purchase this listing before you can submit a review');
    }

    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    // 2. Enforce unique constraint via upsert
    const review = await this.prisma.listingReview.upsert({
      where: {
        listingId_userId: {
          listingId,
          userId,
        },
      },
      update: {
        rating,
        comment: comment ?? null,
      },
      create: {
        listingId,
        userId,
        rating,
        comment: comment ?? null,
      },
    });

    // 3. Recalculate avgRating and update Listing rating
    const reviews = await this.prisma.listingReview.findMany({
      where: { listingId },
      select: { rating: true },
    });

    const avgRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0.0;

    await this.prisma.listing.update({
      where: { id: listingId },
      data: { rating: avgRating },
    });

    this.logger.log(`User ${userId} reviewed listing ${listingId} with rating ${rating}`);
    return review;
  }

  // ── GET /marketplace/creator/stats ──────────────────────────────────────────

  async getCreatorStats(userId: string) {
    // Fetch all listings created by this user
    const listings = await this.prisma.listing.findMany({
      where: { creatorId: userId },
      include: {
        purchases: {
          where: { status: 'COMPLETED' },
          select: { amountPaid: true },
        },
      },
    });

    let totalSales = 0;
    let totalRevenue = 0;
    let sumRatings = 0;
    let ratedCount = 0;

    for (const listing of listings) {
      totalSales += listing.purchases.length;
      totalRevenue += listing.purchases.reduce((sum, p) => sum + p.amountPaid, 0);
      if (listing.rating > 0) {
        sumRatings += listing.rating;
        ratedCount++;
      }
    }

    const avgRating = ratedCount > 0 ? sumRatings / ratedCount : 0.0;

    // topListings: sorted by salesCount desc, take top 5
    const topListings = [...listings]
      .sort((a, b) => b.salesCount - a.salesCount)
      .slice(0, 5);

    return {
      totalSales,
      totalRevenue, // in cents
      avgRating,
      topListings,
    };
  }

  // ── GET /marketplace/creator/payouts ────────────────────────────────────────

  async getCreatorPayouts(userId: string) {
    return this.prisma.creatorPayout.findMany({
      where: {
        listing: {
          creatorId: userId,
        },
      },
      include: {
        listing: {
          select: {
            title: true,
            price: true,
          },
        },
        purchase: {
          select: {
            createdAt: true,
            buyerId: true,
          },
        },
      },
    });
  }

  // ── GET /marketplace/purchases ──────────────────────────────────────────────

  async getPurchases(userId: string) {
    return this.prisma.purchase.findMany({
      where: {
        buyerId: userId,
        status: 'COMPLETED',
      },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            category: true,
            totalItems: true,
            rating: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}


