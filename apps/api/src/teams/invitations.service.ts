import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrgMemberRole } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create and send an invitation.
   * Token is a 32-byte random hex string (256-bit entropy).
   */
  async inviteUser(params: {
    organizationId: string;
    email: string;
    role: OrgMemberRole;
    invitedById: string;
  }) {
    // Check if email already a member
    const existingMember = await this.prisma.organizationMember.findFirst({
      where: {
        organizationId: params.organizationId,
        user: { email: params.email },
      },
    });
    if (existingMember) {
      throw new ConflictException('User is already a member of this organization');
    }

    // Check for existing pending invite
    const existingInvite = await this.prisma.invitation.findFirst({
      where: {
        organizationId: params.organizationId,
        email: params.email,
        status: 'PENDING',
      },
    });
    if (existingInvite) {
      throw new ConflictException('A pending invitation already exists for this email');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: params.organizationId,
        email: params.email,
        role: params.role,
        token,
        invitedById: params.invitedById,
        expiresAt,
      },
      include: { organization: { select: { name: true } } },
    });

    // TODO: Send invitation email via SES/Resend
    // await this.emailService.sendInvitationEmail({ to: params.email, token, orgName: invitation.organization.name });

    return { success: true, token, expiresAt };
  }

  /**
   * Accept an invitation — adds user to organization.
   */
  async acceptInvitation(token: string, userId: string, userEmail: string) {
    const invitation = await this.prisma.invitation.findUnique({ where: { token } });

    if (!invitation || invitation.status !== 'PENDING') {
      throw new NotFoundException('Invitation not found or already used');
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({ where: { token }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('Invitation has expired');
    }

    if (invitation.email !== userEmail) {
      throw new BadRequestException('This invitation was sent to a different email address');
    }

    // Add to org + mark invitation accepted in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId } },
        create: { organizationId: invitation.organizationId, userId, role: invitation.role },
        update: {},
      });
      await tx.invitation.update({
        where: { token },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
    });

    return { success: true, organizationId: invitation.organizationId, role: invitation.role };
  }

  async listPending(organizationId: string) {
    return this.prisma.invitation.findMany({
      where: { organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvitation(token: string, organizationId: string) {
    await this.prisma.invitation.updateMany({
      where: { token, organizationId, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    return { success: true };
  }
}
