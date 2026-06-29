import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { MobileGateway } from "../auth/mobile.gateway";
import { ChatService } from "../chat/chat.service";
import { RetrievalService } from "../retrieval/retrieval.service";
import { PromptEngineService } from "../prompt-engine/prompt-engine.service";
import { CitationsService } from "../citations/citations.service";
import { ConfigService } from "@nestjs/config";

@Processor("voice-processing")
export class VoiceProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceProcessingProcessor.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mobileGateway: MobileGateway,
    private readonly chatService: ChatService,
    private readonly retrievalService: RetrievalService,
    private readonly promptEngineService: PromptEngineService,
    private readonly citationsService: CitationsService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.aiServiceUrl = this.configService.get<string>(
      "NEXT_PUBLIC_AI_SERVICE_URL",
      "http://localhost:8000",
    );
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { userId, orgId, sessionId, planTier } = job.data;
    const orgPrefix = orgId || "personal";
    const inputKey = `orgs/${orgPrefix}/voice/${sessionId}/input.webm`;

    this.logger.log(`Processing Voice STT-RAG-TTS pipeline job ${job.id} (sessionId: ${sessionId})`);

    try {
      // ─── 1. Call FastAPI STT service ──────────────────────────────────────
      this.mobileGateway.sendVoiceEvent(sessionId, "voice:stt_thinking", {});
      
      const fileUrl = await this.storage.getSignedUrl(inputKey, 3600);
      const downloadResp = await fetch(fileUrl);
      if (!downloadResp.ok) {
        throw new Error(`Failed to download audio input file from Minio: ${downloadResp.statusText}`);
      }
      const audioBuffer = Buffer.from(await downloadResp.arrayBuffer());

      const sttFormData = new FormData();
      sttFormData.append("sessionId", sessionId);
      sttFormData.append("file", new Blob([audioBuffer]), "input.webm");

      const sttResp = await fetch(`${self_or_target_url(this.aiServiceUrl)}/ai/voice/stt`, {
        method: "POST",
        body: sttFormData,
      });

      if (!sttResp.ok) {
        const errText = await sttResp.text();
        throw new Error(`STT service transcription failed: ${errText}`);
      }

      const sttData = await sttResp.json();
      const transcribedText = sttData.text;

      this.logger.log(`Transcribed text: "${transcribedText}" (lang: ${sttData.language})`);
      this.mobileGateway.sendVoiceEvent(sessionId, "voice:stt_done", { text: transcribedText });

      // ─── 2. Call NestJS RAG pipeline ──────────────────────────────────────
      this.mobileGateway.sendVoiceEvent(sessionId, "voice:rag_thinking", {});

      const retrievalResult = await this.retrievalService.retrieveContext(
        userId,
        transcribedText,
      );

      const enrichedCitations = await this.citationsService.enrichCitations(retrievalResult.chunks);

      const systemPrompt = await this.promptEngineService.buildSystemPrompt(
        "study",
        retrievalResult.context,
        "", // no summary context in quick voice loop
      );

      // We need a dummy response object to capture the stream from AI service
      let responseContent = "";
      const dummyResponseMock: any = {
        write: (chunk: string) => {
          if (chunk.startsWith("event: token\ndata: ")) {
            const token = chunk.replace("event: token\ndata: ", "").replace("\n\n", "");
            responseContent += token;
          }
        },
        end: () => {},
      };

      await this.chatService.streamFromAiService(
        systemPrompt,
        transcribedText,
        [], // empty history in quick voice loop
        sessionId,
        enrichedCitations,
        dummyResponseMock,
        userId,
      );

      this.logger.log(`RAG reply context synthesized: "${responseContent}"`);
      this.mobileGateway.sendVoiceEvent(sessionId, "voice:rag_done", { text: responseContent });

      // ─── 3. Call FastAPI TTS service ──────────────────────────────────────
      this.mobileGateway.sendVoiceEvent(sessionId, "voice:tts_thinking", {});

      const ttsWebSocketUrl = `${this.aiServiceUrl.replace("http://", "ws://")}/ai/voice/ws`;
      
      await new Promise<void>((resolve, reject) => {
        const WebSocket = require("ws");
        const ws = new WebSocket(ttsWebSocketUrl);

        ws.on("open", () => {
          ws.send(JSON.stringify({
            event: "voice:tts",
            data: {
              text: responseContent,
              planTier: planTier || "FREE",
              sessionId,
              orgId,
            }
          }));
        });

        ws.on("message", (msg: string) => {
          try {
            const payload = JSON.parse(msg);
            const { event, data } = payload;

            if (event === "voice:audio_chunk") {
              // Pipe chunks directly to client socket room
              this.mobileGateway.sendVoiceEvent(sessionId, "voice:audio_chunk", {
                seq: data.seq,
                base64: data.base64,
              });
            } else if (event === "voice:done") {
              ws.close();
              resolve();
            } else if (event === "voice:error") {
              ws.close();
              reject(new Error(data.message || "TTS error"));
            }
          } catch (e) {
            ws.close();
            reject(e);
          }
        });

        ws.on("error", (err: any) => {
          ws.close();
          reject(err);
        });
      });

      // Update final ready state in Postgres VoiceSession
      await this.prisma.voiceSession.update({
        where: { sessionId },
        data: {
          status: "READY",
          ttsAudioKey: `orgs/${orgPrefix}/voice/${sessionId}/output.mp3`,
        },
      });

      this.mobileGateway.sendVoiceEvent(sessionId, "voice:done", {
        sessionId,
        ttsAudioKey: `orgs/${orgPrefix}/voice/${sessionId}/output.mp3`,
      });

      // Schedule delayed (1hr) voice cleanup task using BullMQ voice-cleanup queue
      try {
        const { Queue } = require("bullmq");
        const redisHost = this.configService.get<string>("REDIS_HOST", "localhost");
        const redisPort = Number(this.configService.get<number>("REDIS_PORT", 6379));
        const redisPassword = this.configService.get<string>("REDIS_PASSWORD", "") || undefined;

        const delayedQueue = new Queue("voice-cleanup", {
          connection: {
            host: redisHost,
            port: redisPort,
            password: redisPassword,
            skipVersionCheck: true,
          },
        });

        await delayedQueue.add("cleanup-voice-session", { orgId, sessionId }, { delay: 3600000 });
        this.logger.log(`Scheduled delayed voice cleanup task for sessionId: ${sessionId}`);
        await delayedQueue.close();
      } catch (cleanupQueueErr: any) {
        this.logger.warn(`Failed to schedule delayed voice cleanup task: ${cleanupQueueErr.message}`);
      }

      return { success: true };
    } catch (err: any) {
      this.logger.error(`Voice STT-RAG-TTS pipeline failed: ${err.message}`);
      
      await this.prisma.voiceSession.update({
        where: { sessionId },
        data: { status: "FAILED" },
      }).catch(() => {});

      this.mobileGateway.sendVoiceEvent(sessionId, "voice:error", {
        code: "PIPELINE_FAILED",
        message: err.message,
      });

      throw err;
    }
  }
}

function self_or_target_url(url: string): string {
  // If running inside docker container network, resolve local endpoints
  return url.replace("localhost", "host.docker.internal");
}
