export type GroupVisibility = 'PUBLIC' | 'PRIVATE';
export type GroupStatus = 'ACTIVE' | 'ARCHIVED';
export type GroupRole = 'LEADER' | 'MEMBER';
export type SessionStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED';
export type SessionType = 'STUDY' | 'QUIZ' | 'EXAM_PREP';
export type MessageType = 'TEXT' | 'AI' | 'SYSTEM';

export interface User {
  id: string;
  name: string | null;
  email: string;
  avatar: string | null;
}

export interface Document {
  id: string;
  title: string;
  fileType: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  role: GroupRole;
  joinedAt: string;
  lastActiveAt: string;
  user: User;
}

export interface GroupSession {
  id: string;
  groupId: string;
  title: string;
  status: SessionStatus;
  sessionType: SessionType;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  sessionId: string | null;
  userId: string;
  content: string;
  citations: any;
  messageType: MessageType;
  createdAt: string;
  user?: User;
}

export interface GroupDocument {
  groupId: string;
  docId: string;
  addedBy: string;
  addedAt: string;
  document: Document;
}

export interface StudyGroup {
  id: string;
  orgId: string;
  name: string;
  createdBy: string;
  maxMembers: number;
  visibility: GroupVisibility;
  status: GroupStatus;
  createdAt: string;
  updatedAt: string;
  _count?: {
    members: number;
    sessions: number;
    documents: number;
  };
  members?: GroupMember[];
  documents?: GroupDocument[];
  sessions?: GroupSession[];
}
