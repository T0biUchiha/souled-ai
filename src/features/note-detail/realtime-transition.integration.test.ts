import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { testAcknowledgements } from '../../backend/realtime';
import { reconcileRealtimeNote } from '../../data/realtime-reconcile';
import { mergeRealtimeVersion } from '../../data/realtime-reconcile';
import { beginOptimisticTransition, reconcileTransitionEvents } from './optimistic-transition';
import type { Note, ReviewEvent, User } from '../../domain';

const reviewer: User = { id: 'reviewer-1', displayName: 'Reviewer A', roles: ['REVIEWER'] };
const note: Note = { id: 'note-3', patientId: 'p', encounterId: 'e', status: 'READY_FOR_REVIEW', currentVersionId: 'version-3-1', assignedReviewerId: null, approvedAt: null, createdAt: '', updatedAt: '', createdById: 'c' };

describe('realtime transition integration', () => {
  it('reconciles status event arriving before transition acknowledgement', async () => {
    const client = new QueryClient(); const context = { note, actor: reviewer, source: 'USER' as const, now: '2026-01-01T00:00:00.000Z', mfaReauthenticated: false };
    const optimistic = beginOptimisticTransition(context, { type: 'start_review' }, 'temporary-1');
    expect(optimistic?.optimisticNote.status).toBe('IN_REVIEW');
    client.setQueryData(['note', note.id], { ...note, events: [optimistic!.temporaryEvent] });
    testAcknowledgements.pause('transition');
    const serverEvent: ReviewEvent = { id: 'event-1', noteId: note.id, versionId: note.currentVersionId, action: 'start_review', actorId: reviewer.id, occurredAt: '2026-01-01T00:00:01.000Z', fromStatus: 'READY_FOR_REVIEW', toStatus: 'IN_REVIEW', reason: null, metadata: {} };
    const beforeAck = client.getQueryData<{ events: ReviewEvent[] }>(['note', note.id])!;
    client.setQueryData(['note', note.id], { ...beforeAck, ...reconcileRealtimeNote(optimistic!.optimisticNote, { id: 'rt-1', cursor: 1, type: 'note.status_changed', noteId: note.id, action: 'start_review', fromStatus: 'READY_FOR_REVIEW', toStatus: 'IN_REVIEW', occurredAt: serverEvent.occurredAt }), events: reconcileTransitionEvents(beforeAck.events, optimistic!.temporaryEvent.id, serverEvent) });
    expect(client.getQueryData<{ status: string; events: ReviewEvent[] }>(['note', note.id])).toMatchObject({ status: 'IN_REVIEW', events: [{ id: 'event-1' }] });
    testAcknowledgements.release('transition');
  });

  it('deduplicates duplicate realtime versions in the query cache', () => {
    const client = new QueryClient(); const version = { id: 'version-3-2', noteId: note.id, parentVersionId: 'version-3-1', content: { subjective: '', objective: '', assessment: '', plan: '' }, createdAt: '', createdById: reviewer.id, amendmentReason: null };
    client.setQueryData(['note', note.id], { versions: [version] });
    const current = client.getQueryData<{ versions: typeof version[] }>(['note', note.id])!;
    client.setQueryData(['note', note.id], { versions: mergeRealtimeVersion(current.versions, version) });
    expect(client.getQueryData<{ versions: typeof version[] }>(['note', note.id])!.versions).toHaveLength(1);
  });

  it('ignores a stale status event after newer server truth', () => {
    const newer = { ...note, status: 'APPROVED' as const, assignedReviewerId: null };
    const stale = { id: 'rt-11', cursor: 11, type: 'note.status_changed' as const, noteId: note.id, action: 'start_review' as const, fromStatus: 'READY_FOR_REVIEW' as const, toStatus: 'IN_REVIEW' as const, occurredAt: '' };
    expect(reconcileRealtimeNote(newer, stale)).toEqual(newer);
  });
});
