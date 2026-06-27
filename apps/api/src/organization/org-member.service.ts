import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { CacheService } from "../common/services/cache.service";
import { OrgMemberRole, InvitationStatus } from "@prisma/client";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";

/** Role hierarchy: OWNER > ADMIN > MEMBER > VIEWER */
const ROLE_WEIGHT: Record<OrgMemberRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

@Injectable()
export class OrgMemberService {
  private readonly inviteSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectQueue("org-notifications") private readonly orgQueue: Queue,
  ) {
    this.inviteSecret =
      this.config.get<string>("INVITE_SECRET") ||
      this.config.get<string>("JWT_ACCESS_SECRET", "invite-fallback-secret");
  }

  // ────────────────────────────────────────────────────────────────
  // INVITE
  // ────────────────────────────────────────────────────────────────

  async invite(orgId: string, inviterId: string, dto: InviteMemberDto) {
    const { email, role = "MEMBER" } = dto;

    // 1. Verify inviter has ADMIN or OWNER privileges
    await this.assertMinRole(orgId, inviterId, "ADMIN");

    // 2. Reject if target is already a member
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const alreadyMember = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: existingUser.id } },
      });
      if (alreadyMember) {
        throw new ConflictException("User is already a member of this organization");
      }
    }

    // 3. Enforce seat limit from org plan
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        plan: { select: { maxUsers: true, name: true } },
        members: { select: { id: true } },
      },
    });

    if (org?.plan?.maxUsers !== null && org?.plan?.maxUsers !== undefined) {
      const currentSeats = org.members.length;
      if (currentSeats >= org.plan.maxUsers) {
        throw new ConflictException(
          `Seat limit reached (${currentSeats}/${org.plan.maxUsers} seats used on ${org.plan.name} plan). ` +
            `Upgrade your plan to invite more members.`,
        );
      }
    }

    // 3. Revoke any previous pending invite for this email+org
    await this.prisma.invitation.updateMany({
      where: { organizationId: orgId, email, status: InvitationStatus.PENDING },
      data: { status: InvitationStatus.REVOKED },
    });

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // 4. Sign JWT invite token (single-use enforced by DB `acceptedAt`)
    const inviteToken = this.jwtService.sign(
      { orgId, email, role, type: "org-invite" },
      { secret: this.inviteSecret, expiresIn: "48h" },
    );

    // 5. Persist the invitation record
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId: orgId,
        email,
        role: role as OrgMemberRole,
        token: inviteToken,
        status: InvitationStatus.PENDING,
        invitedById: inviterId,
        expiresAt,
      },
      include: { organization: { select: { name: true } } },
    });

    // 6. Dispatch BullMQ email job
    await this.orgQueue.add("send-invite-email", {
      email,
      inviterUserId: inviterId,
      orgName: invitation.organization.name,
      token: inviteToken,
      expiresAt,
    });

    return { message: "Invitation sent", invitationId: invitation.id, expiresAt };
  }

  // ────────────────────────────────────────────────────────────────
  // ACCEPT INVITE
  // ────────────────────────────────────────────────────────────────

  async acceptInvite(token: string, acceptingUserId: string, acceptingUserEmail: string) {
    // 1. Verify JWT signature + expiry
    let payload: { orgId: string; email: string; role: string; type: string };
    try {
      payload = this.jwtService.verify(token, { secret: this.inviteSecret });
    } catch {
      throw new UnauthorizedException("Invite token is invalid or has expired");
    }

    if (payload.type !== "org-invite") {
      throw new BadRequestException("Not a valid org invite token");
    }

    // 2. Look up invitation record (check single-use)
    const invitation = await this.prisma.invitation.findUnique({ where: { token } });

    if (!invitation) {
      throw new NotFoundException("Invitation not found");
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Invitation is ${invitation.status.toLowerCase()} and cannot be accepted`,
      );
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException("Invitation has expired");
    }

    // 3. Email must match (protect against token forwarding attacks)
    if (invitation.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
      throw new ForbiddenException("This invitation was issued for a different email address");
    }

    // 4. Atomic: mark invitation used + create OrgMember
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });

      // Upsert to handle race conditions gracefully
      await tx.orgMember.upsert({
        where: { orgId_userId: { orgId: invitation.organizationId, userId: acceptingUserId } },
        create: {
          orgId: invitation.organizationId,
          userId: acceptingUserId,
          role: invitation.role,
        },
        update: {
          // If they re-accept after being removed, restore their role
          role: invitation.role,
        },
      });
    });

    return {
      message: "Successfully joined organization",
      orgId: invitation.organizationId,
      role: invitation.role,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // LIST MEMBERS
  // ────────────────────────────────────────────────────────────────

  async listMembers(orgId: string, requesterId: string) {
    await this.assertMembership(orgId, requesterId);

    return this.prisma.orgMember.findMany({
      where: { orgId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
  }

  // ────────────────────────────────────────────────────────────────
  // UPDATE MEMBER ROLE
  // ────────────────────────────────────────────────────────────────

  async updateMemberRole(
    orgId: string,
    targetUserId: string,
    requesterId: string,
    dto: UpdateMemberRoleDto,
  ) {
    const [requesterMembership, targetMembership] = await Promise.all([
      this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: requesterId } },
      }),
      this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: targetUserId } },
      }),
    ]);

    if (!requesterMembership) {
      throw new ForbiddenException("You are not a member of this organization");
    }
    if (!targetMembership) {
      throw new NotFoundException("Target user is not a member of this organization");
    }

    // Only OWNER can promote/demote to/from OWNER
    if (dto.role === "OWNER" || targetMembership.role === "OWNER") {
      if (requesterMembership.role !== "OWNER") {
        throw new ForbiddenException("Only an OWNER can transfer or change the OWNER role");
      }
    } else {
      // Must be ADMIN or OWNER
      if (ROLE_WEIGHT[requesterMembership.role] < ROLE_WEIGHT["ADMIN"]) {
        throw new ForbiddenException("You need at least ADMIN privileges to change member roles");
      }
      // Cannot promote to a role equal or above your own (unless OWNER)
      if (
        requesterMembership.role !== "OWNER" &&
        ROLE_WEIGHT[dto.role as OrgMemberRole] >= ROLE_WEIGHT[requesterMembership.role]
      ) {
        throw new ForbiddenException("You cannot assign a role equal to or above your own");
      }
    }

    const updated = await this.prisma.orgMember.update({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      data: { role: dto.role as OrgMemberRole },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // Invalidate role cache for the target user in this org
    await this.cache.del(`role:${orgId}:${targetUserId}`);

    return updated;
  }

  // ────────────────────────────────────────────────────────────────
  // REMOVE MEMBER
  // ────────────────────────────────────────────────────────────────

  async removeMember(orgId: string, targetUserId: string, requesterId: string) {
    const [requesterMembership, targetMembership] = await Promise.all([
      this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: requesterId } },
      }),
      this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: targetUserId } },
      }),
    ]);

    if (!requesterMembership) {
      throw new ForbiddenException("You are not a member of this organization");
    }
    if (!targetMembership) {
      throw new NotFoundException("Target user is not a member of this organization");
    }

    // Cannot remove the OWNER
    if (targetMembership.role === "OWNER") {
      throw new ForbiddenException("Cannot remove the organization OWNER");
    }

    // Self-removal is always allowed; otherwise need ADMIN+
    const isSelfRemoval = targetUserId === requesterId;
    if (!isSelfRemoval && ROLE_WEIGHT[requesterMembership.role] < ROLE_WEIGHT["ADMIN"]) {
      throw new ForbiddenException("You need at least ADMIN privileges to remove members");
    }

    // ADMINs can only remove MEMBER/VIEWER, not other ADMINs
    if (
      !isSelfRemoval &&
      requesterMembership.role === "ADMIN" &&
      ROLE_WEIGHT[targetMembership.role] >= ROLE_WEIGHT["ADMIN"]
    ) {
      throw new ForbiddenException("ADMINs cannot remove other ADMINs — only OWNERs can");
    }

    await this.prisma.orgMember.delete({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });

    // Invalidate role cache for the removed user
    await this.cache.del(`role:${orgId}:${targetUserId}`);

    return { success: true, message: "Member removed" };
  }

  // ────────────────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────────────────

  private async assertMembership(orgId: string, userId: string) {
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m) throw new ForbiddenException("You are not a member of this organization");
    return m;
  }

  private async assertMinRole(orgId: string, userId: string, minRole: OrgMemberRole) {
    const m = await this.assertMembership(orgId, userId);
    if (ROLE_WEIGHT[m.role] < ROLE_WEIGHT[minRole]) {
      throw new ForbiddenException(
        `Requires at least ${minRole} role. Current role: ${m.role}`,
      );
    }
    return m;
  }
}
