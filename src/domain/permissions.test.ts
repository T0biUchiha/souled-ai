import { describe, expect, it } from 'vitest';
import { can, capabilityDecision } from './permissions';
import type { Note, User } from './types';

const clinician: User = { id: 'clinician-1', displayName: 'Clinician', roles: ['CLINICIAN'] };
const reviewer: User = { id: 'reviewer-1', displayName: 'Reviewer', roles: ['REVIEWER'] };
const note: Note = {
  id: 'note-1', patientId: 'patient-1', encounterId: 'encounter-1', status: 'READY_FOR_REVIEW',
  currentVersionId: 'version-1', assignedReviewerId: null, createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-17T12:00:00.000Z', approvedAt: null, createdById: clinician.id,
};

describe('capability helpers', () => {
  it('derives start-review permission through the state machine', () => {
    expect(can(reviewer, 'note.startReview', note, { now: note.updatedAt })).toBe(true);
    expect(capabilityDecision(clinician, 'note.startReview', note, { now: note.updatedAt }))
      .toMatchObject({ allowed: false, code: 'ROLE_REQUIRED' });
  });

  it('allows a readonly auditor to view notes and history only', () => {
    const auditor: User = { id: 'auditor-1', displayName: 'Auditor', roles: ['READONLY_AUDITOR'] };
    expect(can(auditor, 'note.view', note, { now: note.updatedAt })).toBe(true);
    expect(can(auditor, 'note.viewHistory', note, { now: note.updatedAt })).toBe(true);
    expect(can(auditor, 'note.startReview', note, { now: note.updatedAt })).toBe(false);
  });

  it('allows clinician editing except on locked notes', () => {
    expect(can(clinician, 'note.edit', note, { now: note.updatedAt })).toBe(true);
    expect(can(clinician, 'note.edit', { ...note, status: 'LOCKED' }, { now: note.updatedAt })).toBe(false);
  });
});
