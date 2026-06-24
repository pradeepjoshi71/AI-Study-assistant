import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Processor("document-processing")
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<any> {
    const { documentId } = job.data;
    this.logger.log(`[Queue Worker] Processing document: ID ${documentId}`);

    try {
      // 1. Transition state to PROCESSING
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "PROCESSING" },
      });

      // Simulate document parsing / text extraction duration (2 seconds)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 2. Transition state to READY (placeholder completing the pipeline)
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: "READY" },
      });

      this.logger.log(`[Queue Worker] Document ID ${documentId} is now READY.`);
      return { status: "completed", documentId };
    } catch (err: any) {
      this.logger.error(
        `[Queue Worker] Document processing failed for ID ${documentId}: ${err.message}`,
      );

      // Update database state to FAILED
      await this.prisma.document
        .update({
          where: { id: documentId },
          data: { status: "FAILED" },
        })
        .catch(() => {});

      throw err;
    }
  }
}
