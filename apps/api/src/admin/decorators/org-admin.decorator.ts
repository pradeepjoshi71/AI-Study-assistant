import { SetMetadata } from '@nestjs/common';

export const IS_ORG_ADMIN_KEY = 'isOrgAdmin';
export const OrgAdmin = () => SetMetadata(IS_ORG_ADMIN_KEY, true);
