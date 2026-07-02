import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * RedisService
 *
 * In development (NODE_ENV=development OR REDIS_SENTINEL_ENABLED != "true"):
 *   Connects directly to Redis via REDIS_HOST / REDIS_PORT (default localhost:6379).
 *
 * In production / Docker (REDIS_SENTINEL_ENABLED=true):
 *   Uses Redis Sentinel for HA failover.
 *
 * Both clients use lazyConnect so startup never blocks if Redis is temporarily unreachable.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private replicaClient!: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const sentinelEnabled =
      this.configService.get<string>("REDIS_SENTINEL_ENABLED", "false").toLowerCase() === "true";

    const password = this.configService.get<string>("REDIS_PASSWORD", "") || undefined;

    if (sentinelEnabled) {
      // ── Sentinel mode (Docker / production) ─────────────────────────────
      const sentinelHost = this.configService.get<string>("REDIS_SENTINEL_HOST", "localhost");
      const sentinelPort = Number(
        this.configService.get<number>("REDIS_SENTINEL_PORT", 26379),
      );

      this.logger.log(
        `Redis: Sentinel mode → ${sentinelHost}:${sentinelPort} (master: mymaster)`,
      );

      const sentinelConfig = {
        sentinels: [{ host: sentinelHost, port: sentinelPort }],
        name: "mymaster",
        password,
        lazyConnect: true,
      };

      this.client = new Redis({ ...sentinelConfig, role: "master" } as any);
      this.replicaClient = new Redis({ ...sentinelConfig, role: "slave" } as any);
    } else {
      // ── Direct mode (local dev — no Docker) ─────────────────────────────
      const host = this.configService.get<string>("REDIS_HOST", "localhost");
      const port = Number(this.configService.get<number>("REDIS_PORT", 6379));

      this.logger.log(`Redis: Direct mode → ${host}:${port}`);

      const directConfig = { host, port, password, lazyConnect: true };

      this.client = new Redis(directConfig);
      // In direct mode there's no replica; point both at the same instance
      this.replicaClient = new Redis(directConfig);
    }

    this.client.on("error", (err) =>
      this.logger.warn(`Redis master connection error: ${err.message}`),
    );
    this.replicaClient.on("error", (err) =>
      this.logger.warn(`Redis replica connection error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    try {
      await Promise.all([
        this.client ? this.client.quit() : Promise.resolve(),
        this.replicaClient ? this.replicaClient.quit() : Promise.resolve(),
      ]);
    } catch (err: any) {
      this.logger.warn(`Error disconnecting Redis clients: ${err.message}`);
    }
  }

  getClient(): Redis {
    return this.client;
  }

  getReplicaClient(): Redis {
    return this.replicaClient;
  }
}
