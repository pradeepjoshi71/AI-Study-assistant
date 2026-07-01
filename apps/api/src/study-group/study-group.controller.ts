import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { StudyGroupService } from './study-group.service';
import { CreateStudyGroupDto } from './dto/create-study-group.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { userContextStorage } from '../common/context/user-context';

import { MobileGateway } from '../auth/mobile.gateway';

import { RequiresFeature } from "../common/guards/tenant-feature.guard";

@UseGuards(JwtAuthGuard)
@Controller('groups')
@RequiresFeature("groups")
export class StudyGroupController {
  constructor(
    private readonly studyGroupService: StudyGroupService,
    private readonly mobileGateway: MobileGateway,
  ) {}

  /**
   * POST /groups
   * Creates a study group under the caller's active organization.
   */
  @Post()
  async create(
    @Body() dto: CreateStudyGroupDto,
    @CurrentUser('id') userId: string,
  ) {
    const orgId = userContextStorage.getStore()?.orgId;
    if (!orgId) {
      throw new ForbiddenException('Organization context is required to create a group');
    }
    return this.studyGroupService.create(userId, orgId, dto);
  }

  /**
   * POST /groups/:id/join
   * Joins a group. Auto-joins if PUBLIC, enqueues request if PRIVATE.
   */
  @Post(':id/join')
  async join(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.studyGroupService.join(userId, id);
  }

  /**
   * POST /groups/:id/invite
   * Invites another user. LEADER only.
   */
  @Post(':id/invite')
  async invite(
    @Param('id') id: string,
    @Body('userId') inviteeUserId: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!inviteeUserId) {
      throw new ForbiddenException('invitee userId is required');
    }
    return this.studyGroupService.invite(userId, id, inviteeUserId);
  }

  /**
   * DELETE /groups/:id/members/:userId
   * Removes a member from the group.
   * Can be used by member to leave, or by leader to kick.
   */
  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.studyGroupService.removeMember(userId, id, targetUserId);
  }

  /**
   * POST /groups/:id/docs
   * Adds a document to the group document vault and triggers vector sync.
   */
  @Post(':id/docs')
  async addDocument(
    @Param('id') id: string,
    @Body('docId') docId: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!docId) {
      throw new ForbiddenException('docId is required');
    }
    return this.studyGroupService.addDocument(userId, id, docId);
  }

  /**
   * DELETE /groups/:id/docs/:docId
   * Removes a document from the group document vault and triggers vector cleanup.
   */
  @Delete(':id/docs/:docId')
  async removeDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.studyGroupService.removeDocument(userId, id, docId);
  }

  // ─── GET ENDPOINTS ─────────────────────────────────────────────────────────

  /**
   * GET /groups
   * Lists all study groups caller belongs to.
   */
  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
  ) {
    const orgId = userContextStorage.getStore()?.orgId;
    if (!orgId) {
      throw new ForbiddenException('Organization context is required');
    }
    return this.studyGroupService.findAll(orgId, userId);
  }

  /**
   * GET /groups/:id
   * Fetches details of a single group.
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.studyGroupService.findOne(userId, id);
  }

  /**
   * GET /groups/:id/sessions/:sid/messages
   * Fetches messages in a session with cursor-based pagination.
   */
  @Get(':id/sessions/:sid/messages')
  async findSessionMessages(
    @Param('id') id: string,
    @Param('sid') sid: string,
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.studyGroupService.findSessionMessages(
      userId,
      id,
      sid,
      cursor,
      limit ? Number(limit) : 50,
    );
  }


  // ─── STUDY GROUP SESSION ENDPOINTS ─────────────────────────────────────────


  /**
   * POST /groups/:id/sessions
   * Creates a new study session in SCHEDULED status.
   */
  @Post(':id/sessions')
  async createSession(
    @Param('id') id: string,
    @Body('title') title: string,
    @Body('sessionType') sessionType: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!title || !sessionType) {
      throw new ForbiddenException('title and sessionType are required');
    }
    return this.studyGroupService.createSession(userId, id, title, sessionType);
  }

  /**
   * POST /groups/:id/sessions/:sid/start
   * Starts a study session (LEADER only, emits group:session:started).
   */
  @Post(':id/sessions/:sid/start')
  async startSession(
    @Param('id') id: string,
    @Param('sid') sid: string,
    @CurrentUser('id') userId: string,
  ) {
    const session = await this.studyGroupService.startSession(userId, id, sid);
    this.mobileGateway.server.to(id).emit('group:session:started', {
      groupId: id,
      sessionId: sid,
    });
    return session;
  }

  /**
   * POST /groups/:id/sessions/:sid/end
   * Ends a study session (LEADER only, emits session:ended and dispatches summary).
   */
  @Post(':id/sessions/:sid/end')
  async endSession(
    @Param('id') id: string,
    @Param('sid') sid: string,
    @CurrentUser('id') userId: string,
  ) {
    const session = await this.studyGroupService.endSession(userId, id, sid);
    this.mobileGateway.server.to(id).emit('group:session:ended', {
      groupId: id,
      sessionId: sid,
    });
    return session;
  }
}

