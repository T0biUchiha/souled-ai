import { describe, expect, it } from 'vitest';
import { isNoteReadOnly, selectActions } from './selectors';
import type { Note, User } from './types';

const reviewer: User = { id: 'reviewer-1', displayName: 'Reviewer', roles: ['REVIEWER'] };
const note: Note = {
  id: 'note-1', patientId: 'patient-1', encounterId: 'encounter-1', status: 'IN_REVIEW', currentVersionId: 'version-1',
  assignedReviewerId: reviewer.id, createdAt: '2026-09-16T12:00:00.000Z', updatedAt: '2026-09-17T12:00:00.000Z',
  approvedAt: null, createdById: 'clinician-1',
};

describe('domain UI selectors', () => {
  it('exposes a disabled reject action with the domain reason', () => {
    const actions = selectActions({ note, actor: reviewer, source: 'USER', now: note.updatedAt, mfaReauthenticated: true });
    expect(actions).toContainEqual({ action: 'reject', visible: true, enabled: false, disabledReason: 'A rejection reason is required.' });
  });

  it('enables reject when the feature supplies a valid action payload', () => {
    const actions = selectActions(
      { note, actor: reviewer, source: 'USER', now: note.updatedAt, mfaReauthenticated: true },
      { reject: { type: 'reject', reason: 'Incorrect diagnosis.' } },
    );
    expect(actions).toContainEqual({ action: 'reject', visible: true, enabled: true, disabledReason: null });
  });

  it('marks a locked note as read-only without UI status checks', () => {
    expect(isNoteReadOnly({
      note: { ...note, status: 'LOCKED', assignedReviewerId: null },
      actor: reviewer,
      source: 'USER',
      now: note.updatedAt,
      mfaReauthenticated: true,
    })).toBe(true);
  });
});
