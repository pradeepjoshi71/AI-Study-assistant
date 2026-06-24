import {
  Controller, Get, Post, Delete, Patch, Body, Param, UseGuards,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgMemberRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString } from 'class-validator';

class InviteDto {
  @IsEmail() email!: string;
  @IsEnum(OrgMemberRole) role: OrgMemberRole = OrgMemberRole.MEMBER;
}
class UpdateRoleDto {
  @IsEnum(OrgMemberRole) role!: OrgMemberRole;
}
class AcceptInviteDto {
  @IsString() token!: string;
}

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get('members')
  getMembers(@CurrentUser() user: any) {
    return this.teams.getMembers(user.organizationId);
  }

  @Patch('members/:userId/role')
  updateRole(
    @CurrentUser() user: any,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.teams.updateMemberRole(user.organizationId, targetUserId, dto.role, user.id);
  }

  @Delete('members/:userId')
  removeMember(@CurrentUser() user: any, @Param('userId') targetUserId: string) {
    return this.teams.removeMember(user.organizationId, targetUserId, user.id);
  }

  @Delete('members/me/leave')
  leaveOrg(@CurrentUser() user: any) {
    return this.teams.leaveOrganization(user.organizationId, user.id);
  }

  // ─── Invitations ──────────────────────────────────────────

  @Post('invitations')
  invite(@CurrentUser() user: any, @Body() dto: InviteDto) {
    return this.invitations.inviteUser({
      organizationId: user.organizationId,
      email: dto.email,
      role: dto.role,
      invitedById: user.id,
    });
  }

  @Get('invitations')
  listInvitations(@CurrentUser() user: any) {
    return this.invitations.listPending(user.organizationId);
  }

  @Post('invitations/accept')
  acceptInvite(@CurrentUser() user: any, @Body() dto: AcceptInviteDto) {
    return this.invitations.acceptInvitation(dto.token, user.id, user.email);
  }

  @Delete('invitations/:token')
  revokeInvite(@CurrentUser() user: any, @Param('token') token: string) {
    return this.invitations.revokeInvitation(token, user.organizationId);
  }
}
