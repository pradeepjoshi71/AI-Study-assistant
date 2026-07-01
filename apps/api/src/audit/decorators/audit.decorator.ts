import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA_KEY = 'audit_metadata';

export interface AuditMetadataOptions {
  action: string;
  resourceType: string;
}

export const Audit = (action: string, resourceType: string) =>
  SetMetadata(AUDIT_METADATA_KEY, { action, resourceType } as AuditMetadataOptions);
