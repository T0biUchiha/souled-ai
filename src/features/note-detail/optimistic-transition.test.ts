import { describe, expect, it } from 'vitest';
import { beginOptimisticTransition, reconcileTransitionEvents, rollbackTransitionEvent } from './optimistic-transition';
import type { Note, User } from '../../domain';

const reviewer: User = { id: 'reviewer-1', displayName: 'Reviewer', roles: ['REVIEWER'] };
const note: Note = { id: 'note-1', patientId: 'p1', encounterId: 'e1', status: 'READY_FOR_REVIEW', currentVersionId: 'v1', assignedReviewerId: null, approvedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdById: 'c1' };
describe('optimistic transitions', () => {
  it('optimistically updates then reconciles the temporary event', () => { const pending = beginOptimisticTransition({ note, actor: reviewer, source: 'USER', now: '2026-01-02T00:00:00.000Z', mfaReauthenticated: false }, { type: 'start_review' }, 'tmp-1')!; const serverEvent = { ...pending.temporaryEvent, id: 'event-9', metadata: {} }; expect(pending.optimisticNote.status).toBe('IN_REVIEW'); expect(reconcileTransitionEvents([pending.temporaryEvent], 'tmp-1', serverEvent)).toEqual([serverEvent]); });
  it('rolls back a failed temporary event', () => { const event = { id: 'tmp', noteId: 'n', versionId: null, action: 'viewed' as const, actorId: 'u', occurredAt: '', fromStatus: null, toStatus: null, reason: null, metadata: {} }; expect(rollbackTransitionEvent([event], 'tmp')).toEqual([]); });
});
