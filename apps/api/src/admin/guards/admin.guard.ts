import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { IS_SUPER_ADMIN_KEY } from '../decorators/super-admin.decorator';
import { IS_ORG_ADMIN_KEY } from '../decorators/org-admin.decorator';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User session not found');
    }

    const systemRole = user.systemRole;

    // Rejects non-admin
    if (systemRole !== SystemRole.SUPER_ADMIN && systemRole !== SystemRole.ORG_ADMIN) {
      throw new ForbiddenException('Access denied: Admin privileges required');
    }

    // Check @SuperAdmin() decorator
    const isSuperAdminRequired = this.reflector.getAllAndOverride<boolean>(
      IS_SUPER_ADMIN_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (isSuperAdminRequired && systemRole !== SystemRole.SUPER_ADMIN) {
      throw new ForbiddenException('Access denied: Super Admin privileges required');
    }

    // Check @OrgAdmin() decorator
    const isOrgAdminRequired = this.reflector.getAllAndOverride<boolean>(
      IS_ORG_ADMIN_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (isOrgAdminRequired) {
      if (systemRole === SystemRole.SUPER_ADMIN) {
        return true; // SUPER_ADMIN bypass
      }

      if (systemRole === SystemRole.ORG_ADMIN) {
        const targetOrgId = request.params.orgId || request.params.id || request.body.orgId || request.query.orgId;
        if (!targetOrgId || user.orgId !== targetOrgId) {
          throw new ForbiddenException('Access denied: Scoped Org Admin privileges required for this organization');
        }
        return true;
      }

      return false;
    }

    // If no decorator is specified, then any admin (SUPER_ADMIN or ORG_ADMIN) is allowed
    return true;
  }
}
