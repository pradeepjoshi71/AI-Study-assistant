import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyStatus } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * API Key Format:
 *   sk_live_<32-byte-random-hex>
 *   └──────┘ └────────────────┘
 *    prefix      secret portion
 *
 * Storage:
 *   keyPrefix = first 12 chars (shown in UI, safe to display)
 *   keyHash   = SHA-256 of full key (stored in DB)
 *   Full key  = shown ONCE on creation, never stored
 */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Key Generation ───────────────────────────────────────

  async createApiKey(params: {
    organizationId: string;
    name: string;
    permissions: string[];
    dailyCallLimit?: number;
    monthlyTokenLimit?: number;
    expiresAt?: Date;
    createdById?: string;
  }) {
    const environment = process.env.NODE_ENV === 'production' ? 'live' : 'test';
    const randomPart = crypto.randomBytes(32).toString('hex');
    const fullKey = `sk_${environment}_${randomPart}`;

    // Store only the hash — never the full key
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
    const keyPrefix = fullKey.slice(0, 12); // "sk_live_abcd"

    const apiKey = await this.prisma.apiKey.create({
      data: {
        organizationId: params.organizationId,
        name: params.name,
        keyPrefix,
        keyHash,
        permissions: params.permissions,
        dailyCallLimit: params.dailyCallLimit ?? null,
        monthlyTokenLimit: params.monthlyTokenLimit ?? null,
        expiresAt: params.expiresAt ?? null,
        createdById: params.createdById ?? null,
      },
    });

    // Return full key ONCE — this is the only time it's available
    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix,
      fullKey,  // Show once! Client must store this
      permissions: apiKey.permissions,
      createdAt: apiKey.createdAt,
    };
  }

  // ─── Key Validation ───────────────────────────────────────

  /**
   * Validate an incoming API key from Authorization header.
   * Used by ApiKeyAuthMiddleware.
   */
  async validateKey(rawKey: string): Promise<{
    apiKey: { id: string; organizationId: string; permissions: string[]; dailyCallLimit: number | null };
  }> {
    if (!rawKey || !rawKey.startsWith('sk_')) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.apiKey.findUnique({ where: { keyHash } });

    if (!apiKey) throw new UnauthorizedException('Invalid API key');
    if (apiKey.status === ApiKeyStatus.REVOKED) throw new UnauthorizedException('API key has been revoked');
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) throw new UnauthorizedException('API key has expired');

    // Check org suspension
    const org = await this.prisma.organization.findUnique({
      where: { id: apiKey.organizationId },
      select: { isSuspended: true },
    });
    if (org?.isSuspended) throw new ForbiddenException('Organization suspended');

    // Update last used (non-blocking)
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date(), totalCallCount: { increment: 1 } },
      })
      .catch(() => {});

    return { apiKey: { id: apiKey.id, organizationId: apiKey.organizationId, permissions: apiKey.permissions as string[], dailyCallLimit: apiKey.dailyCallLimit } };
  }

  // ─── Key Management ───────────────────────────────────────

  async listKeys(organizationId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId, status: { not: ApiKeyStatus.REVOKED } },
      select: {
        id: true, name: true, keyPrefix: true, status: true,
        permissions: true, dailyCallLimit: true, totalCallCount: true,
        lastUsedAt: true, expiresAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeKey(id: string, organizationId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, organizationId } });
    if (!key) throw new NotFoundException('API key not found');

    await this.prisma.apiKey.update({
      where: { id },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });

    return { success: true };
  }

  async getKeyUsageStats(id: string, organizationId: string, days = 7) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, organizationId } });
    if (!key) throw new NotFoundException('API key not found');

    const since = new Date(Date.now() - days * 86400 * 1000);
    const logs = await this.prisma.apiUsageLog.groupBy({
      by: ['endpoint'],
      where: { apiKeyId: id, createdAt: { gte: since } },
      _count: true,
      _avg: { latencyMs: true },
      _sum: { tokensIn: true, tokensOut: true },
    });

    return { keyPrefix: key.keyPrefix, totalCalls: key.totalCallCount, logs };
  }
}
