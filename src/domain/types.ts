export type ISODateTime = string;

export type Role = 'CLINICIAN' | 'REVIEWER' | 'ADMIN' | 'READONLY_AUDITOR';

export type NoteStatus =
  | 'GENERATING'
  | 'FAILED'
  | 'READY_FOR_REVIEW'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'AMENDED'
  | 'LOCKED';

export type LifecycleActionType =
  | 'generation.complete'
  | 'generation.error'
  | 'regenerate'
  | 'start_review'
  | 'return'
  | 'approve'
  | 'reject'
  | 'resubmit'
  | 'amend'
  | 'grace_expired';

export type NoteAction = LifecycleActionType | 'version.created' | 'viewed';

export interface User {
  id: string;
  displayName: string;
  roles: readonly Role[];
}

export interface SoapContent {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

/** A workflow container. Clinical text is held by immutable versions, never this record. */
export interface Note {
  id: string;
  patientId: string;
  encounterId: string;
  status: NoteStatus;
  currentVersionId: string | null;
  assignedReviewerId: string | null;
  approvedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdById: string;
}

/** Immutable clinical snapshot. Multiple children may share a parent after competing amendments. */
export interface NoteVersion {
  id: string;
  noteId: string;
  parentVersionId: string | null;
  content: Readonly<SoapContent>;
  createdAt: ISODateTime;
  createdById: string;
  amendmentReason: string | null;
}

/** Append-only audit record; it is never edited or removed by the client. */
export interface ReviewEvent {
  id: string;
  noteId: string;
  versionId: string | null;
  action: NoteAction;
  actorId: string;
  occurredAt: ISODateTime;
  fromStatus: NoteStatus | null;
  toStatus: NoteStatus | null;
  reason: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}
