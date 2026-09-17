import type { SoapContent, Note, NoteStatus, NoteVersion, ReviewEvent, User } from '../domain';
import type { TransitionAction, TransitionSource } from '../domain/state-machine';

export interface NoteSummary extends Note {
  patientName: string;
  contentPreview: string;
}

export interface ListNotesQuery {
  cursor?: string;
  limit?: number;
  statuses?: readonly NoteStatus[];
  reviewerId?: string;
  patient?: string;
  from?: string;
  to?: string;
  search?: string;
  sort?: 'updatedAt' | 'createdAt' | 'patientName' | 'status';
  direction?: 'asc' | 'desc';
}

export interface NotePage {
  items: readonly NoteSummary[];
  nextCursor: string | null;
}

export interface SaveVersionRequest {
  baseVersionId: string;
  content: SoapContent;
  clientMutationId: string;
  amendmentReason?: string;
  actor: User;
}

export interface TransitionRequest {
  action: TransitionAction;
  actor: User | null;
  source?: TransitionSource;
  mfaReauthenticated?: boolean;
}

export interface BulkRequest {
  operation: 'assign_reviewer' | 'regenerate';
  noteIds: readonly string[];
  reviewerId?: string;
  actor: User;
}

export interface BulkResult { updated: readonly Note[]; skipped: readonly string[] }

export type ApiError =
  | { error: 'not_found'; message: string }
  | { error: 'forbidden'; message: string }
  | { error: 'invalid_transition'; message: string; code: string }
  | { error: 'mfa_required'; message: string }
  | { error: 'version_conflict'; current: NoteVersion; commonAncestor: NoteVersion | null }
  | { error: 'invalid_request'; message: string }
  | { error: 'transient_server_error'; message: string; retryable: true };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

export interface NoteDetail extends NoteSummary {
  currentVersion: NoteVersion | null;
  versions: readonly NoteVersion[];
  events: readonly ReviewEvent[];
}
