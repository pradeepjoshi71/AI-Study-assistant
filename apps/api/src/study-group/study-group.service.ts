import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { UseReplica } from '../prisma/replica.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateStudyGroupDto } from './dto/create-study-group.dto';
import { PlanType } from '@prisma/client';

@Injectable()
export class StudyGroupService {
  private readonly logger = new Logger(StudyGroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @InjectQueue('org-notifications') private readonly notificationQueue: Queue,
    @InjectQueue('group-document-sync') private readonly syncQueue: Queue,
    @InjectQueue('group-session-summary') private readonly summaryQueue: Queue,
  ) {}

  // ─── POST /groups (create) ──────────────────────────────────────────────────

  async create(userId: string, orgId: string, dto: CreateStudyGroupDto) {
    // 1. Get organization subscription plan
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: { plan: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    // 2. Enforce max active groups per plan
    const activeGroupsCount = await this.prisma.studyGroup.count({
      where: { orgId, status: 'ACTIVE' },
    });

    const planType = org.plan?.type || PlanType.FREE;
    let maxGroups = 3;
    if (planType === PlanType.PRO) maxGroups = 10;
    else if (planType === PlanType.TEAM || planType === PlanType.ENTERPRISE) maxGroups = 50;

    if (activeGroupsCount >= maxGroups) {
      throw new BadRequestException(
        `Maximum groups limit reached for plan ${planType} (limit: ${maxGroups})`,
      );
    }

    // 3. Create group and assign caller as LEADER in a transaction
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.studyGroup.create({
        data: {
          orgId,
          name: dto.name,
          createdBy: userId,
          maxMembers: dto.maxMembers || 10,
          visibility: dto.visibility as any,
          status: 'ACTIVE' as any,
        },
      });

      await tx.groupMember.create({
        data: {
          groupId: group.id,
          userId,
          role: 'LEADER' as any,
        },
      });

      await tx.groupActivity.create({
        data: {
          groupId: group.id,
          userId,
          action: 'CREATE_GROUP',
          metadata: { name: group.name },
        },
      });

      this.logger.log(`Created study group: ${group.id} (org: ${orgId}, owner: ${userId})`);
      return group;
    });
  }

  // ─── POST /groups/:id/join ──────────────────────────────────────────────────

  async join(userId: string, groupId: string) {
    // 1. Fetch group details with plan type
    const group = await this.prisma.studyGroup.findUnique({
      where: { id: groupId },
      include: {
        organization: { include: { plan: true } },
        members: true,
      },
    });

    if (!group) {
      throw new NotFoundException('Study group not found');
    }

    // 2. Check if already a member/leader
    const existingMember = group.members.find((m) => m.userId === userId);
    if (existingMember) {
      throw new BadRequestException('You are already a member of this group');
    }

    // 3. Enforce plan-based maxMembers limit
    const activeMembersCount = group.members.length;
    const planType = group.organization?.plan?.type || PlanType.FREE;
    let maxMembers = 3;
    if (planType === PlanType.PRO) maxMembers = 10;
    else if (planType === PlanType.TEAM || planType === PlanType.ENTERPRISE) maxMembers = 50;

    if (activeMembersCount >= maxMembers) {
      throw new BadRequestException(
        `Maximum member limit reached for group under plan ${planType} (limit: ${maxMembers})`,
      );
    }

    // 4. Handle Visibility
    if (group.visibility === 'PUBLIC') {
      // Auto-join
      const member = await this.prisma.groupMember.create({
        data: {
          groupId,
          userId,
          role: 'MEMBER' as any,
        },
      });

      await this.prisma.groupActivity.create({
        data: {
          groupId,
          userId,
          action: 'JOIN_GROUP',
          metadata: { userId },
        },
      });

      this.logger.log(`User ${userId} joined public group ${groupId}`);
      return { status: 'JOINED', member };
    } else {
      // PRIVATE: Create pending request in Redis (expire after 7 days)
      const redis = this.redisService.getClient();
      const requestKey = `group:request:${groupId}:${userId}`;
      await redis.set(
        requestKey,
        JSON.stringify({ userId, requestedAt: Date.now() }),
        'EX',
        604800, // 7 days in seconds
      );

      await this.prisma.groupActivity.create({
        data: {
          groupId,
          userId,
          action: 'JOIN_REQUEST',
          metadata: { userId },
        },
      });

      this.logger.log(`User ${userId} requested to join private group ${groupId}`);
      return {
        status: 'PENDING_APPROVAL',
        message: 'Join request sent to group leader',
      };
    }
  }

  // ─── POST /groups/:id/invite ────────────────────────────────────────────────

  async invite(callerId: string, groupId: string, inviteeUserId: string) {
    // 1. Assert caller is LEADER
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: callerId } },
    });
    if (!membership || membership.role !== 'LEADER') {
      throw new ForbiddenException('Only group leaders can invite members');
    }

    // 2. Fetch group
    const group = await this.prisma.studyGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException('Study group not found');
    }

    // 3. Fetch invitee details
    const invitee = await this.prisma.user.findUnique({
      where: { id: inviteeUserId },
    });
    if (!invitee) {
      throw new NotFoundException('Invitee user not found');
    }

    // 4. Verify invitee is not already in group
    const isMember = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: inviteeUserId } },
    });
    if (isMember) {
      throw new BadRequestException('User is already a member of this group');
    }

    // 5. Store pending invite in Redis (expire after 7 days)
    const redis = this.redisService.getClient();
    const inviteKey = `group:invite:${groupId}:${inviteeUserId}`;
    await redis.set(
      inviteKey,
      JSON.stringify({ inviteeUserId, invitedAt: Date.now() }),
      'EX',
      604800, // 7 days in seconds
    );

    // 6. Dispatch BullMQ job to org-notifications queue for email delivery
    await this.notificationQueue.add('invite-member', {
      groupId,
      groupName: group.name,
      inviteeId: inviteeUserId,
      inviteeEmail: invitee.email,
      invitedBy: callerId,
    });

    await this.prisma.groupActivity.create({
      data: {
        groupId,
        userId: callerId,
        action: 'INVITE_USER',
        metadata: { inviteeUserId },
      },
    });

    this.logger.log(`Leader ${callerId} invited ${inviteeUserId} to group ${groupId}`);
    return { success: true, message: 'Invitation sent successfully' };
  }

  // ─── DELETE /groups/:id/members/:userId ──────────────────────────────────────

  async removeMember(callerId: string, groupId: string, targetUserId: string) {
    // 1. Fetch caller membership
    const callerMembership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: callerId } },
    });
    if (!callerMembership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // 2. Fetch target membership
    const targetMembership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });
    if (!targetMembership) {
      throw new NotFoundException('Target member not found in group');
    }

    // 3. Enforce authorization rules
    if (callerId === targetUserId) {
      // User leaving group on their own
      if (callerMembership.role === 'LEADER') {
        // Enforce: LEADER only, cannot remove self if last leader
        const leadersCount = await this.prisma.groupMember.count({
          where: { groupId, role: 'LEADER' },
        });
        if (leadersCount === 1) {
          throw new BadRequestException(
            'Cannot leave group as the last leader. Assign a new leader first.',
          );
        }
      }
    } else {
      // Admin/leader kicking someone else
      if (callerMembership.role !== 'LEADER') {
        throw new ForbiddenException('Only group leaders can remove other members');
      }
    }

    // 4. Remove member
    await this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    await this.prisma.groupActivity.create({
      data: {
        groupId,
        userId: callerId,
        action: callerId === targetUserId ? 'LEAVE_GROUP' : 'KICK_MEMBER',
        metadata: { targetUserId },
      },
    });

    this.logger.log(`Removed user ${targetUserId} from group ${groupId} (actor: ${callerId})`);
    return { success: true, message: 'Member removed successfully' };
  }

  // ─── POST /groups/:id/docs (add document) ───────────────────────────────────

  async addDocument(callerId: string, groupId: string, docId: string) {
    // 1. Verify membership
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: callerId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // 2. Verify document exists
    const document = await this.prisma.document.findUnique({
      where: { id: docId },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // 3. Add to GroupDocument table
    const groupDoc = await this.prisma.groupDocument.create({
      data: {
        groupId,
        docId,
        addedBy: callerId,
      },
    });

    // 4. Dispatch BullMQ job to copy vectors
    await this.syncQueue.add('sync-document', {
      action: 'copy',
      groupId,
      docId,
      addedBy: callerId,
    });

    await this.prisma.groupActivity.create({
      data: {
        groupId,
        userId: callerId,
        action: 'ADD_DOCUMENT',
        metadata: { docId },
      },
    });

    this.logger.log(`Document ${docId} added to group ${groupId} by user ${callerId}`);
    return groupDoc;
  }

  // ─── DELETE /groups/:id/docs/:docId (remove document) ───────────────────────

  async removeDocument(callerId: string, groupId: string, docId: string) {
    // 1. Verify membership
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: callerId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // 2. Delete from GroupDocument table
    await this.prisma.groupDocument.delete({
      where: { groupId_docId: { groupId, docId } },
    });

    // 3. Dispatch BullMQ job to delete vectors
    await this.syncQueue.add('sync-document', {
      action: 'delete',
      groupId,
      docId,
    });

    await this.prisma.groupActivity.create({
      data: {
        groupId,
        userId: callerId,
        action: 'REMOVE_DOCUMENT',
        metadata: { docId },
      },
    });

    this.logger.log(`Document ${docId} removed from group ${groupId} by user ${callerId}`);
    return { success: true, message: 'Document removed successfully' };
  }

  // ─── STUDY GROUP SESSIONS ───────────────────────────────────────────────────

  async createSession(
    userId: string,
    groupId: string,
    title: string,
    sessionType: string,
  ) {
    // 1. Verify membership
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // 2. Create session
    return this.prisma.groupSession.create({
      data: {
        groupId,
        title,
        sessionType: sessionType as any,
        status: 'SCHEDULED' as any,
      },
    });
  }

  async startSession(userId: string, groupId: string, sessionId: string) {
    // 1. Assert leader
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.role !== 'LEADER') {
      throw new ForbiddenException('Only group leaders can start sessions');
    }

    const session = await this.prisma.groupSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.groupId !== groupId) {
      throw new NotFoundException('Session not found in this group');
    }

    const updated = await this.prisma.groupSession.update({
      where: { id: sessionId },
      data: {
        status: 'ACTIVE' as any,
        startedAt: new Date(),
      },
    });

    await this.prisma.groupActivity.create({
      data: {
        groupId,
        userId,
        action: 'START_SESSION',
        metadata: { sessionId },
      },
    });

    return updated;
  }

  async endSession(userId: string, groupId: string, sessionId: string) {
    // 1. Assert leader
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.role !== 'LEADER') {
      throw new ForbiddenException('Only group leaders can end sessions');
    }

    const session = await this.prisma.groupSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.groupId !== groupId) {
      throw new NotFoundException('Session not found in this group');
    }

    const updated = await this.prisma.groupSession.update({
      where: { id: sessionId },
      data: {
        status: 'ENDED' as any,
        endedAt: new Date(),
      },
    });

    // Dispatch summary generation job
    await this.summaryQueue.add('summarize-session', {
      sessionId,
      groupId,
    });

    await this.prisma.groupActivity.create({
      data: {
        groupId,
        userId,
        action: 'END_SESSION',
        metadata: { sessionId },
      },
    });

    return updated;
  }

  // ─── GET ENDPOINTS ─────────────────────────────────────────────────────────

  @UseReplica()
  async findAll(orgId: string, userId: string) {
    // Return groups caller belongs to in this org
    return this.prisma.studyGroup.findMany({
      where: {
        orgId,
        status: 'ACTIVE' as any,
        members: { some: { userId } },
      },
      include: {
        _count: {
          select: { members: true, sessions: true, documents: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseReplica()
  async findOne(userId: string, groupId: string) {
    // Assert membership
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return this.prisma.studyGroup.findUnique({
      where: { id: groupId },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
        documents: { include: { document: true } },
        sessions: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  @UseReplica()
  async findSessionMessages(
    userId: string,
    groupId: string,
    sessionId: string,
    cursor?: string,
    limit = 50,
  ) {
    // Assert membership
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return this.prisma.groupMessage.findMany({
      where: { sessionId },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        user: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}



