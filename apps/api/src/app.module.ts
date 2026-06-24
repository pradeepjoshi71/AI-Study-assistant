import { Module, Get, Controller } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { PrismaService } from "./prisma/prisma.service";
import { RedisService } from "./redis/redis.service";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { StorageModule } from "./storage/storage.module";
import { QueuesModule } from "./queues/queues.module";
import { DocumentsModule } from "./documents/documents.module";

@Controller("health")
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Get()
  async getHealth() {
    let databaseStatus = "UP";
    let redisStatus = "UP";

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      databaseStatus = "DOWN";
    }

    try {
      const redisClient = this.redis.getClient();
      await redisClient.ping();
    } catch (err) {
      redisStatus = "DOWN";
    }

    return {
      status:
        databaseStatus === "UP" && redisStatus === "UP" ? "ok" : "degraded",
      details: {
        database: databaseStatus,
        redis: redisStatus,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100, // Default global limit of 100 requests per 1 minute
      },
    ]),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    StorageModule,
    QueuesModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
