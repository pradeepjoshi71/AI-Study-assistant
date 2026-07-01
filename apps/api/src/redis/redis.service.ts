import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private replicaClient!: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const sentinelHost = this.configService.get<string>("REDIS_SENTINEL_HOST", "localhost");
    const sentinelPort = this.configService.get<number>("REDIS_SENTINEL_PORT", 26379);
    const password = this.configService.get<string>("REDIS_PASSWORD", "");

    this.client = new Redis({
      sentinels: [{ host: sentinelHost, port: Number(sentinelPort) }],
      name: "mymaster",
      role: "master",
      password: password || undefined,
      lazyConnect: true,
    });

    this.replicaClient = new Redis({
      sentinels: [{ host: sentinelHost, port: Number(sentinelPort) }],
      name: "mymaster",
      role: "slave",
      password: password || undefined,
      lazyConnect: true,
    });

    this.client.on("error", (err) => {
      console.warn("Redis Master Sentinel Connection Error:", err.message);
    });

    this.replicaClient.on("error", (err) => {
      console.warn("Redis Replica Sentinel Connection Error:", err.message);
    });
  }

  async onModuleDestroy() {
    try {
      await Promise.all([
        this.client ? this.client.quit() : Promise.resolve(),
        this.replicaClient ? this.replicaClient.quit() : Promise.resolve(),
      ]);
    } catch (err: any) {
      console.warn("Error disconnecting Redis clients:", err.message);
    }
  }

  getClient(): Redis {
    return this.client;
  }

  getReplicaClient(): Redis {
    return this.replicaClient;
  }
}

