import { evaluateTransition, type TransitionAction, type TransitionDecision } from './state-machine';
import type { Note, User } from './types';

export type Capability =
  | 'note.view'
  | 'note.edit'
  | 'note.startReview'
  | 'note.return'
  | 'note.approve'
  | 'note.reject'
  | 'note.resubmit'
  | 'note.amend'
  | 'note.viewHistory';

const actionForCapability: Readonly<Partial<Record<Capability, TransitionAction>>> = {
  'note.edit': { type: 'regenerate' },
  'note.startReview': { type: 'start_review' },
  'note.return': { type: 'return' },
  'note.approve': { type: 'approve' },
  'note.reject': { type: 'reject', reason: 'Provided by the eventual form' },
  'note.resubmit': { type: 'resubmit' },
  'note.amend': { type: 'amend' },
};

export interface CapabilityContext {
  now: string;
  mfaReauthenticated?: boolean;
}

export const capabilityDecision = (
  user: User,
  capability: Capability,
  note: Note,
  context: CapabilityContext,
): TransitionDecision | { allowed: true } => {
  if (capability === 'note.view' || capability === 'note.viewHistory') return { allowed: true };
  if (capability === 'note.edit') {
    if (!user.roles.some((role) => role === 'CLINICIAN' || role === 'ADMIN')) {
      return { allowed: false, code: 'ROLE_REQUIRED', reason: 'Only a clinician or administrator can edit note content.' };
    }
    return note.status === 'LOCKED'
      ? { allowed: false, code: 'INVALID_STATUS', reason: 'Locked notes cannot be edited.' }
      : { allowed: true };
  }
  const action = actionForCapability[capability];
  if (action === undefined) return { allowed: false, code: 'INVALID_STATUS', reason: 'Unsupported capability.' };
  return evaluateTransition({
    note, actor: user, source: 'USER', now: context.now,
    mfaReauthenticated: context.mfaReauthenticated ?? false,
  }, action);
};

/** UX-only helper. The server remains the authorization authority. */
export const can = (user: User, capability: Capability, note: Note, context: CapabilityContext): boolean =>
  capabilityDecision(user, capability, note, context).allowed;
