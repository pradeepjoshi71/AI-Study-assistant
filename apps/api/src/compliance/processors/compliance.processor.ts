import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { StripeService } from '../../billing/stripe.service';
import { QdrantClient } from '../../modules/retrieval/qdrant.client';
import { RedisService } from '../../redis/redis.service';
import { createZipArchive } from '../utils/zip.util';
import { DataExportStatus, DataDeletionStatus } from '@prisma/client';

@Injectable()
@Processor('compliance')
export class ComplianceProcessor extends WorkerHost {
  private readonly logger = new Logger(ComplianceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stripeService: StripeService,
    private readonly qdrantClient: QdrantClient,
    private readonly redisService: RedisService,
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<void> {
    if (job.name === 'export-job') {
      await this.processExport(job);
    } else if (job.name === 'delete-account-job') {
      await this.processDeleteAccount(job);
    } else {
      this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async processExport(job: Job<any>): Promise<void> {
    const { userId, requestId, email } = job.data;
    this.logger.log(`Processing data export request ${requestId} for user ${userId}`);

    try {
      // 1. Fetch user profile (excluding sensitive password hashes)
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error(`User with ID ${userId} not found.`);
      }
      const { password, ...profile } = user as any;

      // 2. Fetch memberships
      const orgMemberships = await this.prisma.orgMember.findMany({
        where: { userId },
        include: { organization: true },
      });

      // 3. Fetch documents (metadata only)
      const documents = await this.prisma.document.findMany({
        where: { userId },
        select: {
          id: true,
          orgId: true,
          title: true,
          originalName: true,
          fileType: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // 4. Fetch chats + messages
      const chats = await this.prisma.conversation.findMany({
        where: { userId },
        include: { messages: true },
      });

      // 5. Fetch quizzes + attempts
      const quizzes = await this.prisma.quiz.findMany({
        where: { userId },
        include: { questions: true, attempts: true },
      });

      // 6. Fetch flashcard decks
      const flashcards = await this.prisma.flashcardDeck.findMany({
        where: { userId },
        include: { flashcards: true },
      });

      const flashcardReviews = await this.prisma.flashcardReview.findMany({
        where: { userId },
      });

      // 7. Fetch progress records
      const userProgress = await this.prisma.userProgress.findMany({
        where: { userId },
      });

      const streak = await this.prisma.streak.findUnique({
        where: { userId },
      });

      const userBadges = await this.prisma.userBadge.findMany({
        where: { userId },
        include: { badge: true },
      });

      const performanceRecords = await this.prisma.performanceRecord.findMany({
        where: { userId },
      });

      const userMasteries = await this.prisma.userMastery.findMany({
        where: { userId },
      });

      // 8. Fetch own audit logs (last 90 days only)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const auditLogs = await this.prisma.auditLog.findMany({
        where: {
          userId,
          createdAt: { gte: ninetyDaysAgo },
        },
      });

      // 9. Fetch consent records
      const consentRecords = await this.prisma.consentRecord.findMany({
        where: { userId },
      });

      // 10. Fetch usage records
      const usageRecords = await this.prisma.usageRecord.findMany({
        where: { userId },
      });

      // Serialization helper handling potential BigInt values safely
      const serialize = (data: any) =>
        Buffer.from(
          JSON.stringify(
            data,
            (_, value) => (typeof value === 'bigint' ? value.toString() : value),
            2,
          ),
          'utf-8',
        );

      // Package everything as separate files
      const zipEntries = [
        { filename: 'profile.json', content: serialize(profile) },
        { filename: 'orgMemberships.json', content: serialize(orgMemberships) },
        { filename: 'documents.json', content: serialize(documents) },
        { filename: 'chats.json', content: serialize(chats) },
        { filename: 'quizzes.json', content: serialize(quizzes) },
        { filename: 'flashcards.json', content: serialize(flashcards) },
        { filename: 'flashcardReviews.json', content: serialize(flashcardReviews) },
        {
          filename: 'progressRecords.json',
          content: serialize({
            userProgress,
            streak,
            userBadges,
            performanceRecords,
            userMasteries,
          }),
        },
        { filename: 'auditLogs.json', content: serialize(auditLogs) },
        { filename: 'consentRecords.json', content: serialize(consentRecords) },
        { filename: 'usageRecords.json', content: serialize(usageRecords) },
      ];

      // Compress data into ZIP format
      const zipBuffer = createZipArchive(zipEntries);

      // Upload file to MinIO
      const storageKey = `compliance/${userId}/export-${requestId}.zip`;
      await this.storage.uploadBuffer(storageKey, zipBuffer, 'application/zip');

      // Generate a pre-signed URL valid for 48 hours (172800 seconds)
      const TTL_SECONDS = 172800;
      const signedUrl = await this.storage.getSignedUrl(storageKey, TTL_SECONDS);

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + TTL_SECONDS);

      // Update the request as completed
      await this.prisma.dataExportRequest.update({
        where: { id: requestId },
        data: {
          status: DataExportStatus.COMPLETED,
          completedAt: new Date(),
          expiresAt,
          downloadUrl: signedUrl,
        },
      });

      // Dispatch job to send download email to the user
      await this.emailQueue.add('send-email', {
        to: email,
        subject: 'Your Data Export Request is Ready',
        body: `Your compliance data export is ready for download. Please click the link below to download your data. This link will expire in 48 hours.\n\n${signedUrl}`,
        downloadUrl: signedUrl,
      });

      this.logger.log(`Export processing succeeded for request: ${requestId}`);
    } catch (err: any) {
      this.logger.error(`Failed to process compliance export: ${err.message}`);

      // Update the request status to FAILED in the database
      await this.prisma.dataExportRequest.update({
        where: { id: requestId },
        data: {
          status: DataExportStatus.FAILED,
          completedAt: new Date(),
        },
      });

      // Send error alert email to the user
      await this.emailQueue.add('send-email', {
        to: email,
        subject: 'Your Data Export Request Failed',
        body: `We are sorry, but we encountered an error while exporting your user data. Please request another export or reach out to support.`,
      });
    }
  }

  private async processDeleteAccount(job: Job<any>): Promise<void> {
    const { userId, requestId, email } = job.data;
    this.logger.log(`Processing account deletion request ${requestId} for user ${userId}`);

    try {
      // 1. Verify request is still in GRACE period
      const deletionRequest = await this.prisma.dataDeletionRequest.findUnique({
        where: { id: requestId },
      });

      if (!deletionRequest || deletionRequest.status !== DataDeletionStatus.GRACE) {
        this.logger.warn(`Deletion request ${requestId} is not in GRACE status. Aborting execution.`);
        return;
      }

      // Update status to PROCESSING
      await this.prisma.dataDeletionRequest.update({
        where: { id: requestId },
        data: { status: DataDeletionStatus.PROCESSING },
      });

      // 1. Anonymize User
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted_${userId}@anon.com`,
          name: 'Deleted User',
          password: '',
        },
      });
      this.logger.log(`Anonymized User profile for ID: ${userId}`);

      // 2. Delete Documents (DB record + Minio objects + Qdrant vectors)
      const docs = await this.prisma.document.findMany({
        where: { userId },
      });
      for (const doc of docs) {
        try {
          await this.storage.delete(doc.storageKey);
        } catch (err: any) {
          this.logger.error(`Failed to delete storage file ${doc.storageKey} for user ${userId}: ${err.message}`);
        }
      }
      await this.prisma.document.deleteMany({ where: { userId } });
      await this.qdrantClient.deletePointsByUserId(userId);
      this.logger.log(`Deleted documents metadata, Minio files, and Qdrant vectors for ID: ${userId}`);

      // 3. Delete Chats, Messages, Quizzes, Flashcards, ProgressRecords, UserMastery, Streaks
      await this.prisma.message.deleteMany({
        where: { conversation: { userId } },
      });
      await this.prisma.conversation.deleteMany({
        where: { userId },
      });
      await this.prisma.quizAttempt.deleteMany({
        where: { userId },
      });
      await this.prisma.quiz.deleteMany({
        where: { userId },
      });
      await this.prisma.flashcardReview.deleteMany({
        where: { userId },
      });
      await this.prisma.flashcard.deleteMany({
        where: { deck: { userId } },
      });
      await this.prisma.flashcardDeck.deleteMany({
        where: { userId },
      });
      await this.prisma.userProgress.deleteMany({
        where: { userId },
      });
      await this.prisma.streak.deleteMany({
        where: { userId },
      });
      await this.prisma.userBadge.deleteMany({
        where: { userId },
      });
      await this.prisma.performanceRecord.deleteMany({
        where: { userId },
      });
      await this.prisma.userMastery.deleteMany({
        where: { userId },
      });
      this.logger.log(`Deleted all chats, quizzes, flashcards, streaks, and progress records for ID: ${userId}`);

      // 4. Cancel Stripe subscription via StripeService
      const subscriptions = await this.prisma.subscription.findMany({
        where: {
          OR: [
            { userId },
            { organization: { members: { some: { userId } } } },
          ],
          stripeSubscriptionId: { not: null },
        },
      });
      for (const sub of subscriptions) {
        try {
          await this.stripeService.cancelSubscription(sub.stripeSubscriptionId!, false);
          this.logger.log(`Cancelled Stripe subscription ${sub.stripeSubscriptionId}`);
        } catch (err: any) {
          this.logger.error(`Failed to cancel Stripe subscription ${sub.stripeSubscriptionId}: ${err.message}`);
        }
      }

      // 5. Delete all DeviceTokens
      await this.prisma.deviceToken.deleteMany({
        where: { userId },
      });
      this.logger.log(`Deleted device tokens for ID: ${userId}`);

      // 6. Add userId to Redis blacklist (permanent)
      const redis = this.redisService.getClient();
      await redis.set(`blacklist:user:${userId}`, 'true');
      this.logger.log(`Added user ${userId} to Redis blacklist`);

      // 7. Retain AuditLog rows (set userId=null, keep actorId)
      await this.prisma.auditLog.updateMany({
        where: { userId },
        data: { userId: null },
      });
      this.logger.log(`Anonymized AuditLog entries for ID: ${userId}`);

      // 8. Update DataDeletionRequest status=COMPLETED
      await this.prisma.dataDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: DataDeletionStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Notify the user of final deletion completion
      await this.emailQueue.add('send-email', {
        to: email,
        subject: 'Account Permanently Deleted',
        body: `Hello, this email is to confirm that your account and all associated personal data have been permanently deleted from our servers.`,
      });

      this.logger.log(`Account deletion successfully finalized for request ${requestId}`);
    } catch (err: any) {
      this.logger.error(`Error executing account deletion job: ${err.message}`);

      // Update the request status to FAILED in the database
      await this.prisma.dataDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: DataDeletionStatus.FAILED,
          completedAt: new Date(),
        },
      });

      // Notify user of failure
      await this.emailQueue.add('send-email', {
        to: email,
        subject: 'Account Deletion Request Issue',
        body: `We encountered an issue during the scheduled deletion of your account. Please contact support.`,
      });
    }
  }
}
