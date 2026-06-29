import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

@Processor("voice-cleanup")
export class VoiceCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { orgId, sessionId } = job.data;
    if (!sessionId) {
      this.logger.error(`Job ${job.id} missing sessionId parameter.`);
      return { success: false, error: "Missing sessionId" };
    }

    const orgPrefix = orgId || "personal";
    const inputKey = `orgs/${orgPrefix}/voice/${sessionId}/input.webm`;
    const outputKey = `orgs/${orgPrefix}/voice/${sessionId}/output.mp3`;

    this.logger.log(`Executing voice cleanup task for sessionId: ${sessionId} (org: ${orgPrefix})`);

    try {
      // 1. Delete WebM input object from Minio S3
      try {
        await this.storage.delete(inputKey);
        this.logger.log(`Deleted WebM input object: ${inputKey}`);
      } catch (err: any) {
        this.logger.warn(`WebM cleanup skipped/failed: ${err.message}`);
      }

      // 2. Delete MP3 output object from Minio S3
      try {
        await this.storage.delete(outputKey);
        this.logger.log(`Deleted MP3 output object: ${outputKey}`);
      } catch (err: any) {
        this.logger.warn(`MP3 cleanup skipped/failed: ${err.message}`);
      }

      // 3. Set VoiceSession status to PURGED in database
      await this.prisma.voiceSession.update({
        where: { sessionId },
        data: { status: "PURGED" },
      });

      this.logger.log(`VoiceSession ${sessionId} successfully purged.`);
      return { success: true };
    } catch (err: any) {
      this.logger.error(`Voice cleanup execution failed for ${sessionId}: ${err.message}`);
      throw err;
    }
  }
}
