export class InviteMemberDto {
  email!: string;
  role?: 'MEMBER' | 'ADMIN' | 'VIEWER';
}
