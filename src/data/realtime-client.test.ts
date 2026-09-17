import { describe, expect, it } from 'vitest';
import { mergeRealtimeVersion, reconcileRealtimeNote } from './realtime-reconcile';
import type { Note, NoteVersion } from '../domain';

const note: Note = { id: 'n', patientId: 'p', encounterId: 'e', status: 'READY_FOR_REVIEW', currentVersionId: 'v1', assignedReviewerId: null, approvedAt: null, createdAt: '', updatedAt: '', createdById: 'c' };
const version: NoteVersion = { id: 'v2', noteId: 'n', parentVersionId: 'v1', content: { subjective: '', objective: '', assessment: '', plan: '' }, createdAt: '', createdById: 'c', amendmentReason: null };
describe('realtime reconciliation', () => {
  it('deduplicates duplicate versions', () => expect(mergeRealtimeVersion([version], version)).toEqual([version]));
  it('ignores out-of-order status events', () => expect(reconcileRealtimeNote(note, { id: 'e', cursor: 1, type: 'note.status_changed', noteId: 'n', action: 'approve', fromStatus: 'IN_REVIEW', toStatus: 'APPROVED', occurredAt: '' })).toEqual(note));
});
