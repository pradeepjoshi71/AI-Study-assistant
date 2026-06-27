import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrgMemberRole } from '@prisma/client';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Membership ───────────────────────────────────────────

  async getMembers(organizationId: string) {
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true, avatar: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async updateMemberRole(
    organizationId: string,
    targetUserId: string,
    newRole: OrgMemberRole,
    actorId: string,
  ) {
    // Validate actor has ADMIN/OWNER rights
    const actorMembership = await this.getMembership(organizationId, actorId);
    if (!actorMembership || !['OWNER', 'ADMIN'].includes(actorMembership.role)) {
      throw new ForbiddenException('Only OWNER or ADMIN can update member roles');
    }

    // Cannot downgrade the only OWNER
    if (newRole !== 'OWNER') {
      const targetMembership = await this.getMembership(organizationId, targetUserId);
      if (targetMembership?.role === 'OWNER') {
        const ownerCount = await this.prisma.organizationMember.count({
          where: { organizationId, role: 'OWNER' },
        });
        if (ownerCount <= 1) {
          throw new ForbiddenException('Cannot demote the only OWNER');
        }
      }
    }

    return this.prisma.organizationMember.update({
      where: {
        organizationId_userId: { organizationId, userId: targetUserId },
      },
      data: { role: newRole },
    });
  }

  async removeMember(
    organizationId: string,
    targetUserId: string,
    actorId: string,
  ) {
    const actorMembership = await this.getMembership(organizationId, actorId);
    if (!actorMembership || !['OWNER', 'ADMIN'].includes(actorMembership.role)) {
      throw new ForbiddenException('Only OWNER or ADMIN can remove members');
    }

    // Cannot remove the only OWNER
    const targetMembership = await this.getMembership(organizationId, targetUserId);
    if (targetMembership?.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the OWNER — transfer ownership first');
    }

    await this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });

    return { success: true };
  }

  async leaveOrganization(organizationId: string, userId: string) {
    const membership = await this.getMembership(organizationId, userId);
    if (!membership) throw new NotFoundException('You are not a member of this organization');
    if (membership.role === 'OWNER') {
      throw new ForbiddenException('Transfer ownership before leaving');
    }
    await this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId, userId } },
    });
    return { success: true };
  }

  async getMembership(organizationId: string, userId: string) {
    return this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  async assertRole(
    organizationId: string,
    userId: string,
    requiredRoles: OrgMemberRole[],
  ): Promise<void> {
    const membership = await this.getMembership(organizationId, userId);
    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        `Requires one of: ${requiredRoles.join(', ')}`,
      );
    }
  }
}
