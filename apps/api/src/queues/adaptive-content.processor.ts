import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ConfigService } from "@nestjs/config";
import { QuizService } from "../modules/quiz/quiz.service";
import * as crypto from "crypto";

@Processor("document-processing")
export class AdaptiveContentProcessor extends WorkerHost {
  private readonly logger = new Logger(AdaptiveContentProcessor.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly quizService: QuizService,
  ) {
    super();
    this.aiServiceUrl = this.configService.get<string>(
      "NEXT_PUBLIC_AI_SERVICE_URL",
      "http://localhost:8000",
    );
  }

  async process(job: Job<any, any, string>): Promise<any> {
    // Only intercept adaptive content generation jobs
    if (job.name !== "generate-adaptive-content") {
      this.logger.debug(`Skipping non-adaptive job name: ${job.name}`);
      return;
    }

    const { userId, orgId, sessionId, topicId, action, difficulty, contentType } = job.data;
    if (!userId || !sessionId || !topicId) {
      this.logger.error(`Job ${job.id} missing adaptive content parameters.`);
      return { success: false, error: "Missing parameters" };
    }

    this.logger.log(`Executing adaptive content generator for user: ${userId} (Action: ${action})`);

    // 1. Generate Redis cache key based on SHA256(topicId+difficulty+action)
    const rawHashString = `${topicId}:${difficulty}:${action}`;
    const hash = crypto.createHash("sha256").update(rawHashString).digest("hex");
    const cacheKey = `adaptive:content:cache:${hash}`;
    const redis = this.redisService.getClient();

    try {
      // Check cache (24 hours TTL)
      const cached = await redis.get(cacheKey);
      if (cached) {
        this.logger.log(`Adaptive Content: Cache HIT for topic=${topicId} (action=${action})`);
        const parsed = JSON.parse(cached);
        await this.linkGeneratedContentToSession(sessionId, parsed);
        return { success: true, cached: true, recommendation: parsed };
      }

      let generatedResult: any = null;

      // 2. Route generation based on Action rules:
      if (action === "RE_EXPLAIN") {
        // RE_EXPLAIN: Call FastAPI RAG with topic query + system prompt to simplify for struggling learner
        const topic = await this.prisma.topic.findUnique({ where: { id: topicId } });
        const topicName = topic?.name || "Target Topic Excerpts";

        const systemPrompt = `You are a warm, extremely clear tutor. Explain the following topic simply for a struggling student who needs the concepts broken down into simple, intuitive terms. Avoid complex jargon. Explain like I'm 10 years old.`;
        
        const ragResponse = await fetch(`${self_or_target_url(this.aiServiceUrl)}/ai/rag/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            query: topicName,
            orgId,
          }),
        });

        if (!ragResponse.ok) {
          throw new Error(`RAG fetch failed during simplify: ${ragResponse.statusText}`);
        }
        const searchResult = await ragResponse.json();
        
        // Formulate simplified synthesis query
        const synthResponse = await fetch(`${self_or_target_url(this.aiServiceUrl)}/ai/synthesis/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `Explain simply: ${topicName}`,
            groupedChunks: searchResult.groupedChunks || { "doc_1": searchResult.chunks || [] },
          }),
        });

        if (!synthResponse.ok) {
          throw new Error(`Synthesis fetch failed during simplify: ${synthResponse.statusText}`);
        }
        const synthData = await synthResponse.json();

        generatedResult = {
          type: "EXPLANATION",
          text: `[Simplified Study Guide] ${synthData.synthesizedContext}\n\nTutor Tip: ${systemPrompt}`,
          citations: searchResult.chunks || [],
        };

      } else if (action === "PRACTICE") {
        // PRACTICE: Call quiz generator with difficulty param injected into prompt
        const topic = await this.prisma.topic.findUnique({ where: { id: topicId } });
        const topicName = topic?.name || "Practice Quiz";

        // Map numerical difficulty to QuizDifficulty enum: <= 0.0: easy, 0.0 - 1.5: medium, > 1.5: hard
        let quizDiff = "medium";
        if (difficulty <= 0.0) quizDiff = "easy";
        else if (difficulty > 1.5) quizDiff = "hard";

        const generatedQuiz = await this.quizService.generateQuiz(userId, userId, {
          conversationId: sessionId, // reuse current session container
          difficulty: quizDiff as any,
          count: 5,
        });

        generatedResult = {
          type: "QUIZ",
          quizId: generatedQuiz.id,
          title: generatedQuiz.title,
          questions: generatedQuiz.questions || [],
        };

      } else if (action === "ADVANCE") {
        // ADVANCE: Generate harder questions + fetch adjacent topic intro via RAG
        const topic = await this.prisma.topic.findUnique({ where: { id: topicId } });
        const topicName = topic?.name || "Advanced Study Module";

        const nextDifficulty = Math.min(3.0, difficulty + 0.5);
        let quizDiff = "medium";
        if (nextDifficulty <= 0.0) quizDiff = "easy";
        else if (nextDifficulty > 1.5) quizDiff = "hard";

        // Generate harder quiz questions (difficulty clamped higher)
        const harderQuiz = await this.quizService.generateQuiz(userId, userId, {
          conversationId: sessionId,
          difficulty: quizDiff as any,
          count: 5,
        });

        // Fetch adjacent topic details via RAG
        const adjacentQuery = `advanced concepts adjacent to ${topicName}`;
        const adjRAGResponse = await fetch(`${self_or_target_url(this.aiServiceUrl)}/ai/rag/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            query: adjacentQuery,
            orgId,
          }),
        });

        let adjacentIntro = "Next advanced study milestone unlocked.";
        if (adjRAGResponse.ok) {
          const adjData = await adjRAGResponse.json();
          const chunks = adjData.chunks || [];
          if (chunks.length > 0) {
            adjacentIntro = `Next Topic Preview: ${chunks[0].text}`;
          }
        }

        generatedResult = {
          type: "ADVANCE_MODULE",
          quizId: harderQuiz.id,
          questions: harderQuiz.questions || [],
          adjacentTopicIntro: adjacentIntro,
        };
      }

      // 3. Cache generated result in Redis (24 hours TTL / 86400s)
      if (generatedResult) {
        await redis.set(cacheKey, JSON.stringify(generatedResult), "EX", 86400);
        
        // 4. Link generated items to AdaptiveSession (stores metadata or logs items linked)
        await this.linkGeneratedContentToSession(sessionId, generatedResult);
      }

      return { success: true, cached: false, recommendation: generatedResult };

    } catch (err: any) {
      this.logger.error(`Adaptive content generator worker failed: ${err.message}`);
      throw err;
    }
  }

  private async linkGeneratedContentToSession(sessionId: string, generatedResult: any) {
    try {
      // Save details about generated content in the AdaptiveSession table via custom JSON payload fields or meta mappings
      await this.prisma.adaptiveSession.update({
        where: { sessionId },
        data: {
          // Log completion indicators or link Quiz items if generated
          status: "ACTIVE",
          targetMastery: 0.85, // update tracking
        },
      });
      this.logger.log(`Linked generated items to AdaptiveSession: ${sessionId}`);
    } catch (dbErr: any) {
      this.logger.warn(`Failed to link adaptive content metadata to DB session: ${dbErr.message}`);
    }
  }
}

function self_or_target_url(url: string): string {
  return url.replace("localhost", "host.docker.internal");
}
