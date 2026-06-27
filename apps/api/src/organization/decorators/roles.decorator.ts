import { SetMetadata } from "@nestjs/common";
import { OrgMemberRole } from "@prisma/client";

export const ROLES_KEY = "org_roles";

/**
 * Attach minimum required role(s) to a controller method.
 *
 * Usage:
 *   @Roles("ADMIN", "OWNER")
 *   @Post(":id/invite")
 *   async invite(...) {}
 *
 * When multiple roles are listed, any one of them satisfies the check.
 */
export const Roles = (...roles: OrgMemberRole[]) => SetMetadata(ROLES_KEY, roles);
