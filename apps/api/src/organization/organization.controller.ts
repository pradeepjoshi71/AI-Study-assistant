import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { OrganizationService } from "./organization.service";
import { OrgMemberService } from "./org-member.service";
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { UpdateOrganizationDto } from "./dto/update-organization.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "./guards/roles.guard";
import { Roles } from "./decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";

@Controller("organizations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly orgMemberService: OrgMemberService,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Org CRUD ────────────────────────────────────────────────────
  // POST /organizations — anyone authenticated can create a new org
  // (no orgId in context yet, so RolesGuard skips — creation bootstraps membership)
  @Post()
  async create(
    @CurrentUser("id") userId: string,
    @Body() createOrganizationDto: CreateOrganizationDto,
  ) {
    return this.organizationService.create(userId, createOrganizationDto);
  }

  @Get()
  async findAll(@CurrentUser("id") userId: string) {
    return this.organizationService.findAllForUser(userId);
  }

  /** GET /organizations/:id — any member (VIEWER+) */
  @Get(":id")
  @Roles("VIEWER", "MEMBER", "ADMIN", "OWNER")
  async findOne(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.organizationService.findOne(id, userId);
  }

  /** PATCH /organizations/:id — ADMIN+ only */
  @Patch(":id")
  @Roles("ADMIN", "OWNER")
  async update(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationService.update(id, userId, updateOrganizationDto);
  }

  /** DELETE /organizations/:id — OWNER only */
  @Delete(":id")
  @Roles("OWNER")
  async remove(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.organizationService.remove(id, userId);
  }

  // ── Org Switching ───────────────────────────────────────────────

  /** POST /organizations/:id/switch — any member can switch into an org they belong to */
  @Post(":id/switch")
  @Roles("VIEWER", "MEMBER", "ADMIN", "OWNER")
  async switch(
    @Param("id") id: string,
    @CurrentUser("id") userId: string,
    @CurrentUser("email") email: string,
  ) {
    // RolesGuard already verified membership; just rotate tokens
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: id, userId } },
    });

    if (!membership) {
      throw new ForbiddenException("You do not have access to this organization");
    }

    return this.authService.generateTokensForUser(userId, email, undefined, id);
  }

  // ── Member Management ───────────────────────────────────────────

  /** GET /organizations/:id/members — VIEWER+ (read-only) */
  @Get(":id/members")
  @Roles("VIEWER", "MEMBER", "ADMIN", "OWNER")
  async listMembers(
    @Param("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.orgMemberService.listMembers(orgId, userId);
  }

  /** POST /organizations/:id/invite — ADMIN+ */
  @Post(":id/invite")
  @Roles("ADMIN", "OWNER")
  async invite(
    @Param("id") orgId: string,
    @CurrentUser("id") userId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.orgMemberService.invite(orgId, userId, dto);
  }

  /**
   * POST /organizations/invite/accept/:token
   * No role restriction — accepting user is joining (not yet a member).
   * JWT auth still required (user must be logged in).
   */
  @Post("invite/accept/:token")
  async acceptInvite(
    @Param("token") token: string,
    @CurrentUser("id") userId: string,
    @CurrentUser("email") email: string,
  ) {
    return this.orgMemberService.acceptInvite(token, userId, email);
  }

  /** PATCH /organizations/:id/members/:memberId — ADMIN+ */
  @Patch(":id/members/:memberId")
  @Roles("ADMIN", "OWNER")
  async updateMemberRole(
    @Param("id") orgId: string,
    @Param("memberId") targetUserId: string,
    @CurrentUser("id") requesterId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.orgMemberService.updateMemberRole(orgId, targetUserId, requesterId, dto);
  }

  /** DELETE /organizations/:id/members/:memberId — ADMIN+ (or self-removal) */
  @Delete(":id/members/:memberId")
  @Roles("ADMIN", "OWNER")
  async removeMember(
    @Param("id") orgId: string,
    @Param("memberId") targetUserId: string,
    @CurrentUser("id") requesterId: string,
  ) {
    // Allow self-removal regardless of role
    if (targetUserId === requesterId) {
      return this.orgMemberService.removeMember(orgId, targetUserId, requesterId);
    }
    return this.orgMemberService.removeMember(orgId, targetUserId, requesterId);
  }
}
