import { describe, expect, it } from 'vitest';
import {
  AMENDMENT_GRACE_PERIOD_MS,
  evaluateTransition,
  transitionSpecifications,
  type TransitionAction,
  type TransitionContext,
} from './state-machine';
import type { Note, User } from './types';

const now = '2026-09-17T12:00:00.000Z';
const clinician: User = { id: 'clinician-1', displayName: 'Clinician', roles: ['CLINICIAN'] };
const reviewer: User = { id: 'reviewer-1', displayName: 'Reviewer', roles: ['REVIEWER'] };
const otherReviewer: User = { id: 'reviewer-2', displayName: 'Other reviewer', roles: ['REVIEWER'] };
const admin: User = { id: 'admin-1', displayName: 'Admin', roles: ['ADMIN'] };

const note = (status: Note['status'], overrides: Partial<Note> = {}): Note => ({
  id: 'note-1', patientId: 'patient-1', encounterId: 'encounter-1', status, currentVersionId: 'version-1',
  assignedReviewerId: status === 'IN_REVIEW' ? reviewer.id : null,
  createdAt: '2026-09-16T12:00:00.000Z', updatedAt: now, createdById: clinician.id,
  approvedAt: status === 'APPROVED' ? '2026-09-17T11:00:00.000Z' : null,
  ...overrides,
});

const context = (status: Note['status'], overrides: Partial<TransitionContext> = {}): TransitionContext => ({
  note: note(status), actor: clinician, source: 'USER', now, mfaReauthenticated: true, ...overrides,
});

describe('transitionSpecifications', () => {
  it('centrally specifies every lifecycle trigger', () => {
    expect(Object.keys(transitionSpecifications)).toEqual([
      'generation.complete', 'generation.error', 'regenerate', 'start_review', 'return',
      'approve', 'reject', 'resubmit', 'amend', 'grace_expired',
    ]);
  });
});

describe('evaluateTransition valid paths', () => {
  const cases: ReadonlyArray<{
    name: string;
    context: TransitionContext;
    action: TransitionAction;
    nextStatus: Note['status'];
  }> = [
    { name: 'completes generation from the server', context: context('GENERATING', { actor: null, source: 'SERVER' }), action: { type: 'generation.complete' }, nextStatus: 'READY_FOR_REVIEW' },
    { name: 'records a generation error from the server', context: context('GENERATING', { actor: null, source: 'SERVER' }), action: { type: 'generation.error' }, nextStatus: 'FAILED' },
    { name: 'regenerates after failure', context: context('FAILED'), action: { type: 'regenerate' }, nextStatus: 'GENERATING' },
    { name: 'assigns a reviewer from ready', context: context('READY_FOR_REVIEW', { actor: reviewer }), action: { type: 'start_review' }, nextStatus: 'IN_REVIEW' },
    { name: 'releases a review', context: context('IN_REVIEW', { actor: reviewer }), action: { type: 'return' }, nextStatus: 'READY_FOR_REVIEW' },
    { name: 'approves with an MFA re-authentication assertion', context: context('IN_REVIEW', { actor: reviewer }), action: { type: 'approve' }, nextStatus: 'APPROVED' },
    { name: 'rejects with a reason', context: context('IN_REVIEW', { actor: reviewer }), action: { type: 'reject', reason: 'Missing medication dosage.' }, nextStatus: 'REJECTED' },
    { name: 'resubmits as a new version', context: context('REJECTED'), action: { type: 'resubmit' }, nextStatus: 'READY_FOR_REVIEW' },
    { name: 'amends during grace period', context: context('APPROVED'), action: { type: 'amend' }, nextStatus: 'AMENDED' },
    { name: 'starts review on an amendment', context: context('AMENDED', { actor: reviewer }), action: { type: 'start_review' }, nextStatus: 'IN_REVIEW' },
    { name: 'locks an approved note when grace expires', context: context('APPROVED', { actor: null, source: 'SCHEDULER' }), action: { type: 'grace_expired' }, nextStatus: 'LOCKED' },
  ];

  it.each(cases)('$name', ({ context: transitionContext, action, nextStatus }) => {
    const decision = evaluateTransition(transitionContext, action);
    expect(decision).toMatchObject({ allowed: true, nextStatus });
  });

  it('emits reviewer assignment and version creation effects', () => {
    const review = evaluateTransition(context('READY_FOR_REVIEW', { actor: reviewer }), { type: 'start_review' });
    const resubmit = evaluateTransition(context('REJECTED'), { type: 'resubmit' });
    expect(review).toMatchObject({ allowed: true, effects: expect.arrayContaining([{ type: 'ASSIGN_REVIEWER', reviewerId: reviewer.id }]) });
    expect(resubmit).toMatchObject({ allowed: true, effects: expect.arrayContaining([{ type: 'CREATE_VERSION', kind: 'RESUBMISSION', parentVersionId: 'version-1' }]) });
  });
});

describe('evaluateTransition denied paths', () => {
  it.each([
    ['invalid role', context('FAILED', { actor: reviewer }), { type: 'regenerate' }, 'ROLE_REQUIRED'],
    ['wrong reviewer', context('IN_REVIEW', { actor: otherReviewer }), { type: 'return' }, 'ASSIGNED_REVIEWER_REQUIRED'],
    ['missing rejection reason', context('IN_REVIEW', { actor: reviewer }), { type: 'reject' }, 'REJECTION_REASON_REQUIRED'],
    ['missing MFA re-authentication', context('IN_REVIEW', { actor: reviewer, mfaReauthenticated: false }), { type: 'approve' }, 'MFA_REAUTH_REQUIRED'],
    ['an expired amendment grace period', context('APPROVED', { now: '2026-09-18T11:00:00.001Z' }), { type: 'amend' }, 'AMENDMENT_GRACE_EXPIRED'],
    ['a locked note', context('LOCKED', { actor: admin }), { type: 'amend' }, 'INVALID_STATUS'],
    ['a user-driven automatic transition', context('GENERATING'), { type: 'generation.complete' }, 'INVALID_SOURCE'],
  ] as const)('%s returns deterministic failure', (_name, transitionContext, action, code) => {
    const decision = evaluateTransition(transitionContext, action);
    expect(decision).toMatchObject({ allowed: false, code });
  });

  it('uses the exact 24-hour grace boundary inclusively', () => {
    const approvedAt = new Date(Date.parse(now) - AMENDMENT_GRACE_PERIOD_MS).toISOString();
    const decision = evaluateTransition(context('APPROVED', { note: note('APPROVED', { approvedAt }) }), { type: 'amend' });
    expect(decision).toMatchObject({ allowed: true, nextStatus: 'AMENDED' });
  });
});
