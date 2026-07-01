import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UseGuards,
  Body,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { MobileJwtAuthGuard } from "../auth/guards/mobile-jwt.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { createId } from "@paralleldrive/cuid2";
import { userContextStorage } from "../common/context/user-context";

import { RequiresFeature } from "../common/guards/tenant-feature.guard";

import { Track } from "../common/decorators/track.decorator";

@UseGuards(MobileJwtAuthGuard)
@Controller("voice")
@RequiresFeature("voice")
export class VoiceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue("voice-processing") private readonly voiceQueue: Queue,
    @InjectQueue("document-processing") private readonly contentQueue: Queue,
  ) {}

  @Post("adaptive/recommendation")
  @Track("feature.usage")
  async handleAdaptiveRecommendation(
    @Body() dto: {
      userId: string;
      orgId?: string;
      sessionId: string;
      topicId: string;
      action: string;
      difficulty: number;
      contentType: string;
    },
  ) {
    // 1. Update AdaptiveSession state in PostgreSQL
    const session = await this.prisma.adaptiveSession.upsert({
      where: { sessionId: dto.sessionId },
      create: {
        userId: dto.userId,
        orgId: dto.orgId || null,
        sessionId: dto.sessionId,
        currentDifficulty: dto.difficulty,
        targetMastery: 0.8, // target mastery default
        status: "ACTIVE",
      },
      update: {
        currentDifficulty: dto.difficulty,
      },
    });

    // 2. Queue background content generation job targeting custom formats (READING, QUIZ, FLASHCARD)
    await this.contentQueue.add("generate-adaptive-content", {
      userId: dto.userId,
      orgId: dto.orgId || null,
      sessionId: dto.sessionId,
      topicId: dto.topicId,
      action: dto.action,
      difficulty: dto.difficulty,
      contentType: dto.contentType,
    }).catch((err) => {
      console.warn(`Adaptive content generation enqueuing skipped: ${err.message}`);
    });

    return {
      success: true,
      adaptiveSessionId: session.id,
    };
  }

  @Post("start")
  @UseInterceptors(FileInterceptor("file"))
  async startVoiceSession(
    @CurrentUser("id") userId: string,
    @CurrentUser("plan") planTier: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("No audio file provided");
    }

    // 1. Validate audio (max 5MB size limit)
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException("Audio file size exceeds maximum limit of 5MB");
    }

    const orgId = userContextStorage.getStore()?.orgId ?? null;
    const sessionId = createId();
    const orgPrefix = orgId || "personal";
    const storageKey = `orgs/${orgPrefix}/voice/${sessionId}/input.webm`;

    try {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      
      // 2. Upload WebM audio to Minio directly
      await this.storage["client"].send(
        new PutObjectCommand({
          Bucket: this.storage["bucket"],
          Key: storageKey,
          Body: file.buffer,
          ContentType: file.mimetype || "audio/webm",
          ContentLength: file.size,
          Metadata: {
            orgId: orgPrefix,
            userId,
            sessionId,
          },
        }),
      );

      // 3. Create VoiceSession record in PostgreSQL
      await this.prisma.voiceSession.create({
        data: {
          userId,
          orgId,
          sessionId,
          status: "PENDING",
        },
      });

      // 4. Dispatch BullMQ voice job
      await this.voiceQueue.add("process-voice-session", {
        userId,
        orgId,
        sessionId,
        planTier: planTier || "FREE",
      });

      return {
        success: true,
        sessionId,
        storageKey,
      };

    } catch (err: any) {
      throw new BadRequestException(`Failed to initialize voice session: ${err.message}`);
    }
  }
}
