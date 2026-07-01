import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger, Injectable } from "@nestjs/common";
import { Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";

@Injectable()
@Processor("listing-moderation", { concurrency: 3 })
export class ListingModerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ListingModerationProcessor.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {
    super();
    this.aiServiceUrl = this.config.get<string>("NEXT_PUBLIC_AI_SERVICE_URL", "http://localhost:8000");
  }

  async process(job: Job<{ listingId: string }>): Promise<void> {
    const { listingId } = job.data;
    this.logger.log(`Starting moderation for listing ${listingId}`);

    // ── 1. Fetch listing and preview items ─────────────────────────────────────
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        creator: { select: { id: true, email: true, name: true } },
        items: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });

    if (!listing) {
      this.logger.warn(`Listing ${listingId} not found — skipping moderation`);
      return;
    }

    // Slice to first previewItemCount items for moderation sample
    const listingFull = {
      ...listing,
      items: listing.items.slice(0, listing.previewItemCount),
    };

    // ── 2. Collect sample content text from quiz/flashcard items ───────────────
    const sampleChunks: string[] = [];

    for (const item of listingFull.items) {
      try {
        if (item.itemType === "QUIZ") {
          const quiz = await this.prisma.quiz.findUnique({
            where: { id: item.itemId },
            select: { title: true, difficulty: true },
          });
          if (quiz) {
            sampleChunks.push(`Quiz: ${quiz.title} (difficulty: ${quiz.difficulty})`);
          }
        } else if (item.itemType === "FLASHCARD") {
          const deck = await this.prisma.flashcardDeck.findUnique({
            where: { id: item.itemId },
            select: { title: true },
          });
          if (deck) {
            sampleChunks.push(`Flashcard Deck: ${deck.title}`);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to fetch content for item ${item.itemId}: ${err.message}`);
      }
    }

    const sampleContent = [
      `Title: ${listingFull.title}`,
      `Description: ${listingFull.description}`,
      `Category: ${listingFull.category}`,
      `Tags: ${listingFull.tags.join(", ")}`,
      ...sampleChunks,
    ].join("\n");

    // ── 3. Call FastAPI moderation endpoint ────────────────────────────────────
    let moderationResult: { safe: boolean; tags: string[]; category: string };
    try {
      const response = await fetch(`${this.aiServiceUrl}/marketplace/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, sampleContent }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI service moderation failed: ${response.status} — ${errText}`);
      }

      moderationResult = await response.json();
    } catch (err: any) {
      this.logger.error(`Moderation API call failed for listing ${listingId}: ${err.message}`);
      // On AI service failure: leave status as DRAFT so creator can retry
      throw err; // BullMQ will retry according to defaultJobOptions
    }

    // ── 4a. Unsafe — mark as REJECTED and notify creator ─────────────────────
    if (!moderationResult.safe) {
      await this.prisma.listing.update({
        where: { id: listingId },
        data: { status: "REJECTED" },
      });

      await this.auditService.log({
        actorType: "system",
        action: "marketplace.listing.auto_rejected",
        resourceType: "Listing",
        resourceId: listingId,
        metadata: {
          reason: "AI safety check failed",
          creatorId: listingFull.creatorId,
        },
      });

      this.logger.warn(
        `[NOTIFY] Creator ${listingFull.creator.email}: Listing "${listingFull.title}" was automatically REJECTED — content failed AI safety review.`,
      );

      return;
    }

    // ── 4b. Safe — update metadata and set status=REVIEW ─────────────────────
    await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: "REVIEW",
        tags: moderationResult.tags.length > 0 ? moderationResult.tags : listingFull.tags,
        category: moderationResult.category || listingFull.category,
      },
    });

    this.logger.log(
      `Listing ${listingId} passed AI moderation — updated tags/category and set status=REVIEW`,
    );

    // ── 5. Index preview content to Qdrant via FastAPI ────────────────────────
    try {
      const chunks = sampleChunks.map((text, i) => ({
        chunkIndex: i,
        text,
        listingId,
        title: listingFull.title,
        tags: moderationResult.tags.length > 0 ? moderationResult.tags : listingFull.tags,
        category: moderationResult.category || listingFull.category,
      }));

      const indexResponse = await fetch(`${this.aiServiceUrl}/marketplace/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          title: listingFull.title,
          tags: moderationResult.tags.length > 0 ? moderationResult.tags : listingFull.tags,
          category: moderationResult.category || listingFull.category,
          chunks,
        }),
      });

      if (!indexResponse.ok) {
        const errText = await indexResponse.text();
        this.logger.warn(`Qdrant indexing failed for listing ${listingId}: ${indexResponse.status} — ${errText}`);
      } else {
        this.logger.log(`Successfully indexed listing ${listingId} to Qdrant marketplace collection`);
      }
    } catch (err: any) {
      // Indexing failure should not block moderation outcome — log and continue
      this.logger.warn(`Qdrant indexing error for listing ${listingId}: ${err.message}`);
    }

    // ── 6. Create admin moderation queue entry via AuditLog ───────────────────
    await this.auditService.log({
      actorType: "system",
      action: "marketplace.listing.awaiting_review",
      resourceType: "Listing",
      resourceId: listingId,
      metadata: {
        listingTitle: listingFull.title,
        creatorId: listingFull.creatorId,
        creatorEmail: listingFull.creator.email,
        aiCategory: moderationResult.category,
        aiTags: moderationResult.tags,
      },
    });

    this.logger.log(
      `Listing ${listingId} — admin moderation queue entry created. Awaiting manual review.`,
    );
  }
}
