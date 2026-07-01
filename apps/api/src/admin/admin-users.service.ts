import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);
  private readonly accessSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectQueue('admin-user-export') private readonly exportQueue: Queue,
    @InjectQueue('stripe-sync') private readonly stripeQueue: Queue,
  ) {
    this.accessSecret = this.config.get<string>('JWT_ACCESS_SECRET', 'access_secret_12345');
  }

  // -- Paginated listing with filters ------------------------------------------

  async listUsers(dto: QueryUsersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(dto);

    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          systemRole: true,
          subscriptionPlan: true,
          isActive: true,
          deletedAt: true,
          createdAt: true,
          organizationMemberships: {
            select: { orgId: true, role: true, organization: { select: { name: true, slug: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, page, limit, items };
  }

  // -- Full user profile --------------------------------------------------------

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organizationMemberships: {
          include: {
            organization: {
              include: { subscription: { include: { plan: true } } },
            },
          },
        },
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    // Usage stats: last 30 days
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [tokenStats, docCount, chatCount] = await Promise.all([
      // Total tokens from usage events attributed to this user across all orgs
      this.prisma.usageEvent.aggregate({
        where: { userId, createdAt: { gte: since30d } },
        _sum: { tokensIn: true, tokensOut: true },
      }),
      this.prisma.document.count({
        where: { userId, createdAt: { gte: since30d } },
      }),
      this.prisma.message.count({
        where: {
          conversation: { userId },
          role: 'USER',
          createdAt: { gte: since30d },
        },
      }),
    ]);

    const { password: _pwd, ...safeUser } = user as any;

    return {
      ...safeUser,
      usageStats30d: {
        tokensIn: tokenStats._sum.tokensIn ?? 0,
        tokensOut: tokenStats._sum.tokensOut ?? 0,
        docCount,
        chatCount,
      },
    };
  }

  // -- PATCH systemRole / status / plan ----------------------------------------

  async updateUser(userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const data: Record<string, unknown> = {};
    if (dto.systemRole !== undefined) data.systemRole = dto.systemRole;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.plan !== undefined) data.subscriptionPlan = dto.plan;

    const updated = await this.prisma.user.update({ where: { id: userId }, data });

    // Dispatch Stripe sync if plan changed
    if (dto.plan !== undefined && user.stripeCustomerId) {
      await this.stripeQueue.add('sync-plan', {
        userId,
        newPlan: dto.plan,
        stripeCustomerId: user.stripeCustomerId,
      });
    }

    this.logger.log(`Admin updated user ${userId}: ${JSON.stringify(dto)}`);

    const { password: _pwd, ...safe } = updated as any;
    return safe;
  }

  // -- Soft delete --------------------------------------------------------------

  async softDeleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if ((user as any).deletedAt) {
      throw new ForbiddenException('User already deleted');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: `deleted_${userId}@anon.com`,
        isActive: false,
      },
    });

    this.logger.warn(`User ${userId} soft-deleted and anonymized`);
    return { success: true };
  }

  // -- Impersonation JWT (SUPER_ADMIN only) -------------------------------------

  async impersonateUser(targetUserId: string, adminId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException(`User ${targetUserId} not found`);
    if ((target as any).deletedAt) {
      throw new ForbiddenException('Cannot impersonate a deleted user');
    }

    const token = this.jwtService.sign(
      {
        sub: targetUserId,
        email: target.email,
        tier: target.subscriptionPlan.toLowerCase(),
        systemRole: target.systemRole,
        impersonatedBy: adminId,
      },
      { secret: this.accessSecret, expiresIn: '15m' },
    );

    // Audit log
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action: 'POST /admin/users/:id/impersonate',
        targetType: 'user',
        targetId: targetUserId,
        metadata: { impersonatedEmail: target.email },
      },
    });

    this.logger.warn(`Admin ${adminId} impersonating user ${targetUserId}`);
    return { accessToken: token, expiresIn: '15m' };
  }

  // -- Enqueue CSV export --------------------------------------------------------

  async enqueueExport(adminId: string, filters: Record<string, unknown>) {
    const job = await this.exportQueue.add(
      'export-users',
      { adminId, filters },
      { attempts: 2, backoff: { type: 'fixed', delay: 5000 } },
    );
    return { jobId: job.id, message: 'Export job queued. Poll /admin/users/export/:jobId for status.' };
  }

  // -- Poll export result --------------------------------------------------------

  async getExportResult(jobId: string) {
    const job = await this.exportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Export job ${jobId} not found`);

    const state = await job.getState();
    if (state !== 'completed') {
      return { jobId, state };
    }
    const result = job.returnvalue as { signedUrl: string };
    return { jobId, state, signedUrl: result.signedUrl };
  }

  // -- Where clause builder -----------------------------------------------------

  private buildWhere(dto: QueryUsersDto) {
    const where: any = {};

    if (dto.plan) where.subscriptionPlan = dto.plan;
    if (dto.systemRole) where.systemRole = dto.systemRole;
    if (dto.orgId) {
      where.organizationMemberships = { some: { orgId: dto.orgId } };
    }

    if (dto.status === 'active') { where.isActive = true; where.deletedAt = null; }
    else if (dto.status === 'inactive') { where.isActive = false; where.deletedAt = null; }
    else if (dto.status === 'deleted') { where.deletedAt = { not: null }; }

    if (dto.createdAtFrom || dto.createdAtTo) {
      where.createdAt = {};
      if (dto.createdAtFrom) where.createdAt.gte = new Date(dto.createdAtFrom);
      if (dto.createdAtTo) where.createdAt.lte = new Date(dto.createdAtTo);
    }

    return where;
  }
}
