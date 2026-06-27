import { Injectable } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";
import { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import { RedisService } from "../../redis/redis.service";

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const redis = this.redisService.getClient();
    const now = Date.now();
    const windowStart = now - ttl;
    const uniqueMember = `${now}-${Math.random()}`;

    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, "-inf", windowStart);
    pipeline.zadd(key, now, uniqueMember);
    pipeline.zcard(key);
    pipeline.zrange(key, 0, 0, "WITHSCORES");
    pipeline.pexpire(key, ttl + 1000);

    const execResults = await pipeline.exec();
    if (!execResults) {
      throw new Error("Redis transaction execution failed");
    }

    for (const [err] of execResults) {
      if (err) {
        throw err;
      }
    }

    const totalHits = execResults[2][1] as number;
    const oldestRange = execResults[3][1] as string[];

    let oldestScore = now;
    if (oldestRange && oldestRange.length >= 2) {
      oldestScore = parseFloat(oldestRange[1]);
    }

    const timeToExpireMs = Math.max(0, oldestScore + ttl - now);
    const timeToExpire = Math.ceil(timeToExpireMs / 1000);

    return {
      totalHits,
      timeToExpire,
    };
  }
}
