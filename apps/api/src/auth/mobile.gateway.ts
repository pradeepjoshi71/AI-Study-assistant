import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../redis/redis.service";
import { PrismaService } from "../prisma/prisma.service";

@WebSocketGateway({
  namespace: "mobile/ws",
  cors: {
    origin: "*",
  },
})
@Injectable()
export class MobileGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(MobileGateway.name);
  private readonly accessSecret: string;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {
    this.accessSecret = this.configService.get<string>(
      "JWT_ACCESS_SECRET",
      "access_secret_12345",
    );
  }

  /**
   * Broadcasts real-time voice pipeline progression events directly to the sessionId room.
   */
  sendVoiceEvent(sessionId: string, event: string, payload: any) {
    this.logger.debug(`Broadcasting voice event ${event} to room ${sessionId}`);
    this.server.to(sessionId).emit(event, payload);
  }

  /**
   * Handles new gateway connections.
   * Authenticates JWT token passed via handshake query params.
   * Saves Socket ID to User ID mapping in Redis.
   * Performs reconnect chunk history playback if client passes a lastMessageId.
   */
  async handleConnection(socket: Socket) {
    const token = socket.handshake.query.token as string;
    const lastMessageId = socket.handshake.query.lastMessageId as string;

    if (!token) {
      this.logger.warn(`WS Connection rejected: Missing token.`);
      socket.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token, { secret: this.accessSecret });
      const userId = payload.sub;
      socket.data = { userId };

      const redis = this.redisService.getClient();

      // Store socketId -> userId mapping in Redis
      await redis.set(`socket:${socket.id}:user`, userId, "EX", 3600); // 1h expiry TTL
      this.logger.log(`WS Client connected: socket ${socket.id} (user: ${userId})`);

      // Automatically join sessionId room if passed in handshake query
      const sessionId = socket.handshake.query.sessionId as string;
      if (sessionId) {
        socket.join(sessionId);
        this.logger.log(`Socket ${socket.id} automatically joined room: ${sessionId}`);
      }

      // If reconnecting with a lastMessageId, replay buffered chunks from Redis stream/list if cached
      if (lastMessageId) {
        this.logger.log(`Client reconnecting. Replaying stream for message: ${lastMessageId}`);
        const bufferKey = `chat:stream:buffer:${lastMessageId}`;
        const chunks = await redis.lrange(bufferKey, 0, -1);
        for (const chunk of chunks) {
          try {
            const parsed = JSON.parse(chunk);
            socket.emit("chat:chunk", { delta: parsed.delta });
          } catch {
            // ignore bad chunks
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`WS Authentication failure: ${err.message}`);
      socket.disconnect();
    }
  }

  @SubscribeMessage("voice:join")
  handleVoiceJoin(
    @MessageBody() payload: { sessionId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const { sessionId } = payload;
    if (sessionId) {
      socket.join(sessionId);
      this.logger.log(`Socket ${socket.id} explicitly joined voice session room: ${sessionId}`);
      return { status: "joined", room: sessionId };
    }
  }

  /**
   * Cleans up Redis mappings on connection disconnect.
   */
  async handleDisconnect(socket: Socket) {
    const userId = socket.data.userId;
    const groupId = socket.data.groupId;
    const redis = this.redisService.getClient();

    if (userId && groupId) {
      const key = `group:presence:${groupId}`;
      await redis.srem(key, userId);
      const members = await redis.smembers(key);
      this.server.to(groupId).emit("group:presence", { groupId, members });
    }

    await redis.del(`socket:${socket.id}:user`);
    this.logger.log(`WS Client disconnected: socket ${socket.id}`);
  }

  /**
   * Receives incoming messages from clients.
   * Emits streaming responses, updating Redis stream buffers sequentially.
   */
  @SubscribeMessage("chat:send")
  async handleChatSend(
    @MessageBody() payload: { sessionId: string; message: string; lastMessageId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    if (!userId) {
      socket.emit("chat:error", { code: "UNAUTHORIZED", message: "User session expired" });
      return;
    }

    const { sessionId, message } = payload;
    const messageId = `msg_${Date.now()}`;
    const redis = this.redisService.getClient();
    const bufferKey = `chat:stream:buffer:${messageId}`;

    try {
      // 1. Save user message to database
      await this.prisma.message.create({
        data: {
          conversationId: sessionId,
          role: "USER",
          content: message,
          tenantId: "personal", // Default mobile org space context
        },
      });

      // 2. Mock AI response stream in chunks
      const responseText = `Received your message: "${message}". Processing insights now...`;
      const words = responseText.split(" ");

      for (let i = 0; i < words.length; i++) {
        const delta = words[i] + (i < words.length - 1 ? " " : "");
        
        // Emits stream chunk event to client
        socket.emit("chat:chunk", { delta });

        // Buffer chunk to Redis for replay safety on disconnection (TTL 10min)
        await redis.rpush(bufferKey, JSON.stringify({ delta }));
        await redis.expire(bufferKey, 600);

        // Sleep briefly to simulate network/AI timing
        await new Promise((r) => setTimeout(r, 80));
      }

      // 3. Save complete system reply to database
      await this.prisma.message.create({
        data: {
          conversationId: sessionId,
          role: "SYSTEM",
          content: responseText,
          tenantId: "personal",
        },
      });

      // 4. Emit stream completion event
      socket.emit("chat:done", {
        messageId,
        citations: [], // citations empty in mobile mock client
      });
    } catch (err: any) {
      this.logger.error(`Failed to handle chat:send event: ${err.message}`);
      socket.emit("chat:error", { code: "INTERNAL_ERROR", message: err.message });
    }
  }

  // ─── STUDY GROUP REALTIME HANDLERS ────────────────────────────────────────

  @SubscribeMessage("group:join")
  async handleGroupJoin(
    @MessageBody() payload: { groupId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    if (!userId) {
      socket.emit("group:error", { message: "Unauthorized" });
      return;
    }

    const { groupId } = payload;
    if (!groupId) return;

    // Validate membership
    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!member) {
      socket.emit("group:error", { message: "You are not a member of this study group" });
      return;
    }

    // Join socket.io room
    socket.join(groupId);
    socket.data.groupId = groupId;

    // Add to Redis presence set
    const redis = this.redisService.getClient();
    const key = `group:presence:${groupId}`;
    await redis.sadd(key, userId);
    await redis.expire(key, 30);

    // Read all online members and broadcast to room
    const members = await redis.smembers(key);
    this.server.to(groupId).emit("group:presence", { groupId, members });
    this.logger.log(`WS User ${userId} joined presence room ${groupId}`);
    return { status: "joined", groupId };
  }

  @SubscribeMessage("group:ping")
  async handleGroupPing(
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    const groupId = socket.data.groupId;
    if (!userId || !groupId) return;

    const redis = this.redisService.getClient();
    const key = `group:presence:${groupId}`;
    
    // Refresh presence in Redis
    await redis.sadd(key, userId);
    await redis.expire(key, 30);

    return { status: "pong" };
  }

  @SubscribeMessage("group:typing")
  async handleGroupTyping(
    @MessageBody() payload: { isTyping: boolean },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    const groupId = socket.data.groupId;
    if (!userId || !groupId) return;

    // Broadcast to room excluding sender
    socket.to(groupId).emit("group:typing", { userId, isTyping: payload.isTyping });
  }

  @SubscribeMessage("group:message")
  async handleGroupMessage(
    @MessageBody() payload: { content: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    const groupId = socket.data.groupId;
    if (!userId || !groupId) {
      socket.emit("group:error", { message: "Unauthorized or not in a group" });
      return;
    }

    try {
      // Persist GroupMessage type = TEXT
      const msg = await this.prisma.groupMessage.create({
        data: {
          groupId,
          userId,
          content: payload.content,
          messageType: 'TEXT' as any,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
            }
          }
        }
      });

      // Broadcast to room
      this.server.to(groupId).emit("group:message", msg);
    } catch (err: any) {
      this.logger.error(`Failed to handle group:message: ${err.message}`);
      socket.emit("group:error", { message: err.message });
    }
  }

  @SubscribeMessage("group:session:end")
  async handleGroupSessionEnd(
    @MessageBody() payload: { sessionId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    const groupId = socket.data.groupId;
    if (!userId || !groupId) return;

    // Assert leader
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.role !== 'LEADER') {
      socket.emit("group:error", { message: "Only group leaders can end sessions" });
      return;
    }

    const redis = this.redisService.getClient();
    
    // Delete room state from Redis
    const presenceKey = `group:presence:${groupId}`;
    await redis.del(presenceKey).catch(() => null);

    // End session in DB if sessionId provided
    if (payload.sessionId) {
      await this.prisma.groupSession.update({
        where: { id: payload.sessionId },
        data: { status: 'ENDED' as any, endedAt: new Date() },
      }).catch(() => null);
    }

    // Broadcast ended event to room
    this.server.to(groupId).emit("group:session:ended", { groupId, sessionId: payload.sessionId });
    this.logger.log(`Group session ended for group ${groupId} by leader ${userId}`);
  }

  // ─── GROUP AI STUDY ASSISTANT (CONCURRENCY LOCKING & RAG SYNC) ──────────────

  @SubscribeMessage("group:ai_query")
  async handleGroupAiQuery(
    @MessageBody() payload: { sessionId: string; query: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId;
    const groupId = socket.data.groupId;
    if (!userId || !groupId) {
      socket.emit("group:error", { message: "Unauthorized or not in a group" });
      return;
    }

    const { sessionId, query } = payload;
    if (!sessionId || !query) return;

    const redis = this.redisService.getClient();
    const lockKey = `group:ai:lock:${sessionId}`;
    const queueKey = `group:ai:queue:${sessionId}`;

    // 1. Check/acquire concurrent query lock (set NX EX 60)
    const acquired = await (redis as any).set(lockKey, userId, 'NX', 'EX', 60);

    if (!acquired) {
      // Locked -> push payload to FIFO queue and notify user
      await redis.lpush(
        queueKey,
        JSON.stringify({ userId, groupId, sessionId, query, socketId: socket.id }),
      );
      socket.emit("group:ai_queued", {
        sessionId,
        message: "AI study assistant is busy. Your query has been queued.",
      });
      this.logger.log(`AI query queued for session ${sessionId} (user: ${userId})`);
      return;
    }

    // Lock acquired -> execute query
    this.executeAiQuery(socket, sessionId, groupId, userId, query);
  }

  private async executeAiQuery(
    socket: Socket,
    sessionId: string,
    groupId: string,
    userId: string,
    query: string,
  ) {
    const redis = this.redisService.getClient();
    const lockKey = `group:ai:lock:${sessionId}`;
    const queueKey = `group:ai:queue:${sessionId}`;

    try {
      // 1. Get current group members (to query fallback personal documents in SharedRAGService)
      const members = await this.prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      const memberIds = members.map((m) => m.userId);

      // 2. Fetch context chunks from FastAPI SharedRAGService
      const aiServiceUrl = this.configService.get<string>(
        'NEXT_PUBLIC_AI_SERVICE_URL',
        'http://localhost:8000',
      );

      const searchRes = await fetch(`${aiServiceUrl}/ai/group/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, query, memberIds }),
      });

      let chunks: any[] = [];
      let context = '';
      let sources: any[] = [];

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const results = searchData.results || [];
        chunks = results.map((r: any) => ({
          id: r.id,
          content: r.payload?.content || '',
          documentId: r.payload?.documentId || '',
        }));
        context = results.map((r: any) => r.payload?.content || '').join('\n\n');
        sources = results.map((r: any) => ({
          documentId: r.payload?.documentId || '',
          pageNumber: r.payload?.pageNumber || 1,
        }));
      }

      // 3. Initiate LLM stream session
      const streamRes = await fetch(`${aiServiceUrl}/ai/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: 'You are a helpful group study assistant. Answer the student\'s question using the provided group study materials.',
          message: query,
          context,
          chunks: chunks.map((c) => ({
            id: c.id,
            content: c.content,
            documentId: c.documentId,
            chunkIndex: 0,
            metadata: { source_pages: [1] }
          })),
          userPlan: 'PRO',
        }),
      });

      if (!streamRes.ok) {
        throw new Error(`LLM stream failed: ${streamRes.statusText}`);
      }

      // 4. Stream response to entire room
      const reader = streamRes.body;
      if (!reader) throw new Error('No stream body received');

      const textDecoder = new TextDecoder();
      let buffer = '';
      let collectedText = '';
      let citations: any[] = [];

      for await (const rawChunk of reader as any) {
        buffer += textDecoder.decode(rawChunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();
            if (data) {
              collectedText += data;
              this.server.to(groupId).emit('group:ai_chunk', { sessionId, token: data });
            }
          } else if (trimmed.startsWith('event: citation')) {
            // parse optional citation mappings
            try {
              const citationJson = lines[lines.indexOf(line) + 1]?.trim().slice(5);
              if (citationJson) citations = JSON.parse(citationJson);
            } catch { /* ignore */ }
          }
        }
      }

      // 5. Persist AI reply as GroupMessage
      const msg = await this.prisma.groupMessage.create({
        data: {
          groupId,
          sessionId,
          userId,
          content: collectedText || 'No reply generated.',
          messageType: 'AI' as any,
          citations: citations.length > 0 ? citations : (sources.length > 0 ? sources : []),
        },
      });

      // Broadcast complete message to room
      this.server.to(groupId).emit('group:message', msg);

      // 6. Track token usage in UsageRecord (Phase 2.2)
      const tokenCost = Math.ceil((collectedText.length + query.length) / 4);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      await this.prisma.usageRecord.upsert({
        where: { userId_date: { userId, date: today } },
        create: { userId, date: today, tokensUsed: tokenCost, uploadsCount: 0 },
        update: { tokensUsed: { increment: tokenCost } },
      }).catch((e) => this.logger.warn(`Failed to update usage record: ${e.message}`));

    } catch (err: any) {
      this.logger.error(`executeAiQuery failed: ${err.message}`);
      this.server.to(groupId).emit('group:error', {
        message: `Assistant failed to query: ${err.message}`,
      });
    } finally {
      // 7. Release lock and process next queued request
      await redis.del(lockKey).catch(() => null);

      const nextRaw = await redis.rpop(queueKey);
      if (nextRaw) {
        try {
          const next = JSON.parse(nextRaw);
          // Re-acquire lock for next item
          const acquired = await (redis as any).set(lockKey, next.userId, 'NX', 'EX', 60);
          if (acquired) {
            this.executeAiQuery(socket, next.sessionId, next.groupId, next.userId, next.query);
          } else {
            // Lock re-acquisition failed, push back to tail
            await redis.rpush(queueKey, nextRaw);
          }
        } catch { /* ignore bad payload */ }
      }
    }
  }
}


