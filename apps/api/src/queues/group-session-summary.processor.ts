import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { XPService } from '../gamification/xp.service';
import { ConfigService } from '@nestjs/config';

@Processor('group-session-summary')
export class GroupSessionSummaryProcessor extends WorkerHost {
  private readonly logger = new Logger(GroupSessionSummaryProcessor.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly xpService: XPService,
    private readonly config: ConfigService,
  ) {
    super();
    this.aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  async process(job: Job<any>): Promise<any> {
    const { sessionId, groupId } = job.data as { sessionId: string; groupId: string };
    this.logger.log(`Processing summary for session: ${sessionId} (group: ${groupId})`);

    try {
      // 1. Fetch group details
      const group = await this.prisma.studyGroup.findUnique({
        where: { id: groupId },
      });
      if (!group) {
        this.logger.warn(`Group not found for session summary: ${groupId}`);
        return;
      }

      // 2. Fetch all messages in the session
      const messages = await this.prisma.groupMessage.findMany({
        where: { sessionId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      });

      if (messages.length === 0) {
        this.logger.log(`No messages in session ${sessionId}. Skipping summary.`);
        return;
      }

      // 3. Compile participation map and chat log
      const participationMap: Record<string, number> = {};
      const logLines: string[] = [];

      for (const m of messages) {
        if (m.userId) {
          participationMap[m.userId] = (participationMap[m.userId] || 0) + 1;
          logLines.push(`${m.user?.name || m.userId}: ${m.content}`);
        }
      }

      const chatLog = logLines.join('\n');

      // 4. Request summary from FastAPI AI service
      const res = await fetch(`${this.aiServiceUrl}/ai/group/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatLog }),
      });

      let topicsCovered: string[] = [];
      let keyInsights: string[] = [];
      let questionsAsked: string[] = [];

      if (res.ok) {
        const data = (await res.json()) as any;
        topicsCovered = data.topicsCovered || [];
        keyInsights = data.keyInsights || [];
        questionsAsked = data.questionsAsked || [];
      } else {
        this.logger.warn(`FastAPI summary request failed: ${res.statusText}`);
      }

      // 5. Generate beautiful markdown summary
      const summaryMarkdown = `
### 📝 Group Study Session Summary

**Topics Covered:**
${topicsCovered.map((t) => `- ${t}`).join('\n') || '- No specific topics identified.'}

**Key Insights:**
${keyInsights.map((i) => `- ${i}`).join('\n') || '- No key insights generated.'}

**Questions Asked:**
${questionsAsked.map((q) => `- ${q}`).join('\n') || '- No questions recorded.'}
      `.trim();

      // 6. Save summary as SYSTEM message in DB
      await this.prisma.groupMessage.create({
        data: {
          groupId,
          sessionId,
          userId: group.createdBy,
          content: summaryMarkdown,
          messageType: 'SYSTEM' as any,
          citations: {
            topicsCovered,
            keyInsights,
            questionsAsked,
            participationMap,
          },
        },
      });

      // 7. Award XP to all participants (Phase 2.6)
      const participants = Object.keys(participationMap);
      this.logger.log(`Awarding XP to ${participants.length} participants in session ${sessionId}`);

      for (const userId of participants) {
        await this.xpService.award(
          userId,
          group.orgId,
          'SESSION_30MIN',
          `session-summary-${sessionId}-${userId}`,
        ).catch((err) => {
          this.logger.warn(`Failed to award XP to user ${userId}: ${err.message}`);
        });
      }

    } catch (err: any) {
      this.logger.error(`Session summary processing failed: ${err.message}`);
      throw err;
    }
  }
}
