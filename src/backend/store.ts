import { evaluateTransition, type TransitionDecision } from '../domain/state-machine';
import type { Note, NoteVersion, ReviewEvent } from '../domain';
import type {
  ApiResult, BulkRequest, BulkResult, ListNotesQuery, NoteDetail, NotePage, NoteSummary, SaveVersionRequest, TransitionRequest, TransitionResponse,
} from './contracts';
import { createSeedData } from './seed';
import { realtimeBus } from './realtime';

export interface DummyBackendOptions { seedCount?: number; now?: () => string }

type StoredNote = { note: Note; patientName: string };

const defaultNow = (): string => new Date().toISOString();
const compare = (left: string, right: string): number => left.localeCompare(right);
const encodeCursor = (value: string, id: string): string => Buffer.from(JSON.stringify({ value, id })).toString('base64url');
const decodeCursor = (cursor: string): { value: string; id: string } | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'value' in parsed && 'id' in parsed
      && typeof parsed.value === 'string' && typeof parsed.id === 'string') {
      return { value: parsed.value, id: parsed.id };
    }
  } catch { /* Invalid cursors are treated as the first page. */ }
  return null;
};

export class DummyBackendStore {
  private readonly notes = new Map<string, StoredNote>();
  private readonly versions = new Map<string, NoteVersion>();
  private readonly events: ReviewEvent[] = [];
  private readonly mutations = new Map<string, NoteVersion>();
  private versionSequence = 0;
  private eventSequence = 0;
  private readonly now: () => string;

  constructor(options: DummyBackendOptions = {}) {
    this.now = options.now ?? defaultNow;
    this.seed(options.seedCount ?? 5_000);
  }

  seed(count = 5_000): void {
    this.reset();
    for (const item of createSeedData(count)) {
      this.notes.set(item.note.id, { note: item.note, patientName: item.patientName });
      this.versions.set(item.version.id, item.version);
      this.events.push(...item.events);
    }
    this.versionSequence = count;
  }

  reset(): void {
    this.notes.clear(); this.versions.clear(); this.events.length = 0; this.mutations.clear();
    this.versionSequence = 0; this.eventSequence = 0;
  }

  listNotes(query: ListNotesQuery = {}): NotePage {
    const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
    const sort = query.sort ?? 'updatedAt';
    const direction = query.direction ?? 'desc';
    const matched = [...this.notes.values()].filter(({ note, patientName }) => {
      const current = note.currentVersionId === null ? undefined : this.versions.get(note.currentVersionId);
      const haystack = `${patientName} ${current === undefined ? '' : Object.values(current.content).join(' ')}`.toLowerCase();
      return (query.statuses === undefined || query.statuses.includes(note.status))
        && (query.reviewerId === undefined || note.assignedReviewerId === query.reviewerId)
        && (query.patient === undefined || patientName.toLowerCase().includes(query.patient.toLowerCase()))
        && (query.search === undefined || haystack.includes(query.search.toLowerCase()))
        && (query.from === undefined || note.updatedAt >= query.from)
        && (query.to === undefined || note.updatedAt <= query.to);
    }).sort((left, right) => {
      const leftValue = sort === 'patientName' ? left.patientName : String(left.note[sort]);
      const rightValue = sort === 'patientName' ? right.patientName : String(right.note[sort]);
      const primary = compare(leftValue, rightValue) * (direction === 'asc' ? 1 : -1);
      return primary === 0 ? compare(left.note.id, right.note.id) : primary;
    });
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const afterCursor = cursor === null ? matched : matched.filter((item) => {
      const value = sort === 'patientName' ? item.patientName : String(item.note[sort]);
      const comparison = compare(value, cursor.value) * (direction === 'asc' ? 1 : -1);
      return comparison > 0 || (comparison === 0 && compare(item.note.id, cursor.id) > 0);
    });
    const page = afterCursor.slice(0, limit);
    const items = page.map((item) => this.toSummary(item));
    const last = page.at(-1);
    const nextCursor = last === undefined || afterCursor.length <= limit ? null
      : encodeCursor(sort === 'patientName' ? last.patientName : String(last.note[sort]), last.note.id);
    return { items, nextCursor };
  }

  getNote(noteId: string): ApiResult<NoteDetail> {
    const stored = this.notes.get(noteId);
    if (stored === undefined) return { ok: false, status: 404, error: { error: 'not_found', message: 'Note not found.' } };
    const currentVersion = stored.note.currentVersionId === null ? null : this.versions.get(stored.note.currentVersionId) ?? null;
    const versions = [...this.versions.values()].filter((version) => version.noteId === noteId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { ok: true, data: { ...this.toSummary(stored), currentVersion, versions, events: this.events.filter((event) => event.noteId === noteId) } };
  }

  saveVersion(noteId: string, request: SaveVersionRequest): ApiResult<NoteVersion> {
    const retried = this.mutations.get(request.clientMutationId);
    if (retried !== undefined) return { ok: true, data: retried };
    const stored = this.notes.get(noteId);
    if (stored === undefined) return { ok: false, status: 404, error: { error: 'not_found', message: 'Note not found.' } };
    if (stored.note.currentVersionId !== request.baseVersionId) {
      const current = stored.note.currentVersionId === null ? undefined : this.versions.get(stored.note.currentVersionId);
      if (current === undefined) return { ok: false, status: 409, error: { error: 'version_conflict', current: this.versions.get(request.baseVersionId)!, commonAncestor: null } };
      return { ok: false, status: 409, error: { error: 'version_conflict', current, commonAncestor: this.commonAncestor(current.id, request.baseVersionId) } };
    }
    const version: NoteVersion = {
      id: `version-${++this.versionSequence}`, noteId, parentVersionId: request.baseVersionId,
      content: { ...request.content }, createdAt: this.now(), createdById: request.actor.id,
      amendmentReason: request.amendmentReason?.trim() || null,
    };
    this.versions.set(version.id, version); this.mutations.set(request.clientMutationId, version);
    stored.note = { ...stored.note, currentVersionId: version.id, updatedAt: version.createdAt };
    this.appendEvent(stored.note, version.id, 'version.created', request.actor.id, null, stored.note.status, stored.note.status, { clientMutationId: request.clientMutationId });
    realtimeBus.publish({ type: 'note.version_added', noteId, version, occurredAt: version.createdAt });
    return { ok: true, data: version };
  }

  transition(noteId: string, request: TransitionRequest): ApiResult<TransitionResponse> {
    const stored = this.notes.get(noteId);
    if (stored === undefined) return { ok: false, status: 404, error: { error: 'not_found', message: 'Note not found.' } };
    const source = request.source ?? 'USER';
    const decision = evaluateTransition({ note: stored.note, actor: request.actor, source, now: this.now(), mfaReauthenticated: request.mfaReauthenticated ?? false }, request.action);
    if (!decision.allowed) return this.transitionFailure(decision);
    const now = this.now();
    const reviewerEffect = decision.effects.find((effect) => effect.type === 'ASSIGN_REVIEWER');
    const releaseReviewer = decision.effects.some((effect) => effect.type === 'RELEASE_REVIEWER');
    const current = stored.note;
    const versionEffect = decision.effects.find((effect) => effect.type === 'CREATE_VERSION');
    const baseVersion = current.currentVersionId === null ? undefined : this.versions.get(current.currentVersionId);
    const createdVersion = versionEffect?.type === 'CREATE_VERSION' && baseVersion !== undefined ? {
      id: `version-${++this.versionSequence}`, noteId, parentVersionId: baseVersion.id, content: { ...baseVersion.content },
      createdAt: now, createdById: request.actor?.id ?? 'system', amendmentReason: request.action.type === 'amend' ? request.action.reason?.trim() || null : null,
    } satisfies NoteVersion : undefined;
    if (createdVersion !== undefined) this.versions.set(createdVersion.id, createdVersion);
    stored.note = {
      ...current, status: decision.nextStatus, updatedAt: now,
      assignedReviewerId: reviewerEffect?.type === 'ASSIGN_REVIEWER' ? reviewerEffect.reviewerId : releaseReviewer ? null : current.assignedReviewerId,
      approvedAt: decision.nextStatus === 'APPROVED' ? now : current.approvedAt,
      currentVersionId: createdVersion?.id ?? current.currentVersionId,
    };
    const event = this.appendEvent(stored.note, stored.note.currentVersionId, request.action.type, request.actor?.id ?? 'system', request.action.type === 'reject' || request.action.type === 'amend' ? request.action.reason?.trim() || null : null, current.status, stored.note.status, { source });
    if (createdVersion !== undefined) realtimeBus.publish({ type: 'note.version_added', noteId, version: createdVersion, occurredAt: now });
    realtimeBus.publish({ type: 'note.status_changed', noteId, action: event.action, fromStatus: current.status, toStatus: stored.note.status, occurredAt: now });
    return { ok: true, data: { note: stored.note, event } };
  }

  bulk(request: BulkRequest): ApiResult<BulkResult> {
    const updated: Note[] = [];
    const skipped: string[] = [];
    for (const noteId of request.noteIds) {
      const stored = this.notes.get(noteId);
      if (stored === undefined) { skipped.push(noteId); continue; }
      if (request.operation === 'assign_reviewer') {
        if (request.reviewerId === undefined || request.reviewerId === '') { skipped.push(noteId); continue; }
        stored.note = { ...stored.note, assignedReviewerId: request.reviewerId, updatedAt: this.now() };
        updated.push(stored.note); continue;
      }
      const result = this.transition(noteId, { action: { type: 'regenerate' }, actor: request.actor });
      if (result.ok) updated.push(result.data.note); else skipped.push(noteId);
    }
    return { ok: true, data: { updated, skipped } };
  }

  private transitionFailure(decision: Extract<TransitionDecision, { allowed: false }>): ApiResult<never> {
    if (decision.code === 'MFA_REAUTH_REQUIRED') return { ok: false, status: 403, error: { error: 'mfa_required', message: decision.reason } };
    if (decision.code === 'ROLE_REQUIRED' || decision.code === 'ASSIGNED_REVIEWER_REQUIRED') return { ok: false, status: 403, error: { error: 'forbidden', message: decision.reason } };
    return { ok: false, status: 422, error: { error: 'invalid_transition', message: decision.reason, code: decision.code } };
  }

  private toSummary(stored: StoredNote): NoteSummary {
    const current = stored.note.currentVersionId === null ? undefined : this.versions.get(stored.note.currentVersionId);
    return { ...stored.note, patientName: stored.patientName, contentPreview: current === undefined ? '' : current.content.assessment };
  }

  private commonAncestor(firstId: string, secondId: string): NoteVersion | null {
    const ancestors = new Set<string>();
    let cursor: NoteVersion | undefined = this.versions.get(firstId);
    while (cursor !== undefined) { ancestors.add(cursor.id); cursor = cursor.parentVersionId === null ? undefined : this.versions.get(cursor.parentVersionId); }
    cursor = this.versions.get(secondId);
    while (cursor !== undefined) { if (ancestors.has(cursor.id)) return cursor; cursor = cursor.parentVersionId === null ? undefined : this.versions.get(cursor.parentVersionId); }
    return null;
  }

  private appendEvent(note: Note, versionId: string | null, action: ReviewEvent['action'], actorId: string, reason: string | null, fromStatus: Note['status'], toStatus: Note['status'], metadata: ReviewEvent['metadata']): ReviewEvent {
    const event: ReviewEvent = { id: `event-${++this.eventSequence}`, noteId: note.id, versionId, action, actorId, occurredAt: this.now(), fromStatus, toStatus, reason, metadata };
    this.events.push(event); return event;
  }
}
