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
    const redis = this.redisService.getClient();
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
}
