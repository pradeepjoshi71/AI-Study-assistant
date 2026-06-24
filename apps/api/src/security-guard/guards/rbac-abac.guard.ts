import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgMemberRole } from '@prisma/client';

@Injectable()
export class RbacAbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const apiKeyContext = request.apiKeyContext;

    // 1. Resolve organization and user identity
    const organizationId = user?.organizationId || apiKeyContext?.organizationId;
    const userId = user?.id;

    if (!organizationId) {
      throw new UnauthorizedException('Authentication credentials missing organization context');
    }

    // 2. Org-level RBAC role enforcement (VIEWER cannot write)
    const orgMembership = userId
      ? await this.prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId,
              userId,
            },
          },
        })
      : null;

    const orgRole = orgMembership?.role;

    const method = request.method;
    if (orgRole === OrgMemberRole.VIEWER && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new ForbiddenException('Enterprise role VIEWER is restricted to read-only access.');
    }

    // 3. ABAC: Resource Ownership & Tenant Isolation
    // Automatically inspects request params for common resource keys and enforces matching tenantId

    // A) Document validation
    const documentId = request.params.documentId || request.params.id || request.body.documentId;
    if (documentId && context.getHandler().name.includes('document')) {
      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        include: { user: { include: { organizationMemberships: true } } },
      });

      if (doc) {
        const docOrgId = doc.user.organizationMemberships[0]?.organizationId;
        if (docOrgId !== organizationId) {
          throw new ForbiddenException('Tenant Isolation Violation: Access to resource denied.');
        }
      }
    }

    // B) Conversation validation
    const conversationId = request.params.conversationId || request.body.conversationId;
    if (conversationId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (conv && conv.tenantId !== organizationId) {
        throw new ForbiddenException('Tenant Isolation Violation: Access to conversation denied.');
      }
    }

    return true;
  }
}
