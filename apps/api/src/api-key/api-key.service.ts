import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyStatus } from '@prisma/client';
import { ApiKeyCacheService } from './api-key-cache.service';

export interface CreateApiKeyParams {
  organizationId: string;
  userId?: string;
  name: string;
  scopes: string[];
  permissions?: string[];
  dailyCallLimit?: number;
  monthlyTokenLimit?: number;
  expiresAt?: Date;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ApiKeyCacheService,
    @InjectQueue('api-key-usage') private readonly usageQueue: Queue,
  ) {}

  // ─── Key Generation ──────────────────────────────────────────────────────────

  /**
   * Generate a new API key. The raw key is returned ONCE and never stored.
   * Prefix: ska_live_ (production) or ska_test_ (non-production).
   */
  async createKey(params: CreateApiKeyParams): Promise<{
    id: string;
    name: string;
    keyPrefix: string;
    fullKey: string;  // ← shown ONCE only
    scopes: string[];
    expiresAt: Date | null;
    createdAt: Date;
  }> {
    const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
    const randomPart = crypto.randomBytes(32).toString('hex');
    const fullKey = `ska_${env}_${randomPart}`;

    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
    const keyPrefix = fullKey.slice(0, 12); // e.g. "ska_live_abc"

    // Guard against (astronomically unlikely) hash collision
    const existing = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    if (existing) {
      throw new ConflictException('Key hash collision — please retry.');
    }

    const apiKey = await this.prisma.apiKey.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        name: params.name,
        keyPrefix,
        keyHash,
        scopes: params.scopes,
        permissions: params.permissions ?? params.scopes,
        dailyCallLimit: params.dailyCallLimit ?? null,
        monthlyTokenLimit: params.monthlyTokenLimit ?? null,
        expiresAt: params.expiresAt ?? null,
        createdById: params.userId ?? null,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix,
      fullKey,          // Shown ONCE — client must store it
      scopes: apiKey.scopes as string[],
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  // ─── Key Management ──────────────────────────────────────────────────────────

  async listKeys(organizationId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId, status: { not: ApiKeyStatus.REVOKED } },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        status: true,
        dailyCallLimit: true,
        totalCallCount: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeKey(id: string, organizationId: string): Promise<{ success: true }> {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
      select: { id: true, keyHash: true, status: true },
    });
    if (!key) throw new NotFoundException('API key not found.');
    if (key.status === ApiKeyStatus.REVOKED) {
      throw new ConflictException('API key is already revoked.');
    }

    await this.prisma.apiKey.update({
      where: { id },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });

    // Immediately evict from Redis so no further requests are accepted
    await this.cache.evict(key.keyHash);

    return { success: true };
  }

  async getKey(id: string, organizationId: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        status: true,
        permissions: true,
        dailyCallLimit: true,
        monthlyTokenLimit: true,
        totalCallCount: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!key) throw new NotFoundException('API key not found.');
    return key;
  }

  // ─── Usage Stats ─────────────────────────────────────────────────────────────

  async getUsageStats(id: string, organizationId: string, days = 7) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
      select: { id: true, keyPrefix: true, totalCallCount: true },
    });
    if (!key) throw new NotFoundException('API key not found.');

    const since = new Date(Date.now() - days * 86_400_000);

    const byEndpoint = await this.prisma.aPIKeyUsage.groupBy({
      by: ['endpoint'],
      where: { keyId: id, createdAt: { gte: since } },
      _count: true,
      _avg: { latencyMs: true, tokensUsed: true },
    });

    const dailyBreakdown = await this.prisma.aPIKeyUsage.groupBy({
      by: ['createdAt'],
      where: { keyId: id, createdAt: { gte: since } },
      _count: true,
      _sum: { tokensUsed: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      keyPrefix: key.keyPrefix,
      totalCalls: key.totalCallCount,
      byEndpoint,
      dailyBreakdown,
    };
  }

  // ─── Internal: async lastUsedAt update (called by BullMQ worker) ─────────────

  async updateLastUsed(keyId: string): Promise<void> {
    await this.prisma.apiKey
      .update({
        where: { id: keyId },
        data: { lastUsedAt: new Date(), totalCallCount: { increment: 1 } },
      })
      .catch((err) =>
        this.logger.warn(`Failed to update lastUsedAt for key ${keyId}: ${err.message}`),
      );
  }

  async logUsage(data: {
    keyId: string;
    endpoint: string;
    method: string;
    statusCode: number;
    latencyMs: number;
    tokensUsed?: number;
  }): Promise<void> {
    await this.prisma.aPIKeyUsage
      .create({
        data: {
          keyId: data.keyId,
          endpoint: data.endpoint,
          method: data.method,
          statusCode: data.statusCode,
          latencyMs: data.latencyMs,
          tokensUsed: data.tokensUsed ?? 0,
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to log API key usage for key ${data.keyId}: ${err.message}`),
      );
  }
}

