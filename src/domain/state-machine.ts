import type { LifecycleActionType, Note, NoteStatus, Role, User } from './types';

export const AMENDMENT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

export type TransitionAction =
  | { type: 'generation.complete' }
  | { type: 'generation.error'; reason?: string }
  | { type: 'regenerate' }
  | { type: 'start_review' }
  | { type: 'return' }
  | { type: 'approve' }
  | { type: 'reject'; reason?: string }
  | { type: 'resubmit' }
  | { type: 'amend'; reason?: string }
  | { type: 'grace_expired' };

export type TransitionSource = 'USER' | 'SERVER' | 'SCHEDULER';

export interface TransitionContext {
  note: Note;
  actor: User | null;
  source: TransitionSource;
  now: string;
  mfaReauthenticated: boolean;
}

export type TransitionEffect =
  | { type: 'ASSIGN_REVIEWER'; reviewerId: string }
  | { type: 'RELEASE_REVIEWER' }
  | { type: 'CREATE_VERSION'; kind: 'RESUBMISSION' | 'AMENDMENT'; parentVersionId: string }
  | { type: 'RECORD_MFA_REAUTHENTICATION' }
  | { type: 'CREATE_AUDIT_EVENT' };

export interface TransitionMetadata {
  action: LifecycleActionType;
  source: TransitionSource;
  fromStatus: NoteStatus;
  requiresMfaReauthentication: boolean;
}

export type TransitionAllowed = {
  allowed: true;
  nextStatus: NoteStatus;
  effects: readonly TransitionEffect[];
  metadata: TransitionMetadata;
};

export type TransitionDenied = {
  allowed: false;
  code:
    | 'INVALID_STATUS'
    | 'INVALID_SOURCE'
    | 'ACTOR_REQUIRED'
    | 'ROLE_REQUIRED'
    | 'ASSIGNED_REVIEWER_REQUIRED'
    | 'REJECTION_REASON_REQUIRED'
    | 'MFA_REAUTH_REQUIRED'
    | 'AMENDMENT_GRACE_EXPIRED'
    | 'CURRENT_VERSION_REQUIRED';
  reason: string;
};

export type TransitionDecision = TransitionAllowed | TransitionDenied;

type Guard =
  | 'actor'
  | 'assignedReviewer'
  | 'rejectionReason'
  | 'mfaReauthenticated'
  | 'withinAmendmentGrace'
  | 'currentVersion';

export interface TransitionSpecification {
  action: LifecycleActionType;
  from: readonly NoteStatus[];
  nextStatus: NoteStatus;
  sources: readonly TransitionSource[];
  roles?: readonly Role[];
  guards?: readonly Guard[];
  effects: readonly TransitionEffect['type'][];
}

/** The single source of truth for lifecycle transitions, their authorization, and effects. */
export const transitionSpecifications: Readonly<Record<LifecycleActionType, TransitionSpecification>> = {
  'generation.complete': {
    action: 'generation.complete', from: ['GENERATING'], nextStatus: 'READY_FOR_REVIEW',
    sources: ['SERVER'], effects: ['CREATE_AUDIT_EVENT'],
  },
  'generation.error': {
    action: 'generation.error', from: ['GENERATING'], nextStatus: 'FAILED',
    sources: ['SERVER'], effects: ['CREATE_AUDIT_EVENT'],
  },
  regenerate: {
    action: 'regenerate', from: ['FAILED'], nextStatus: 'GENERATING', sources: ['USER'],
    roles: ['CLINICIAN', 'ADMIN'], guards: ['actor'], effects: ['CREATE_AUDIT_EVENT'],
  },
  start_review: {
    action: 'start_review', from: ['READY_FOR_REVIEW', 'AMENDED'], nextStatus: 'IN_REVIEW',
    sources: ['USER'], roles: ['REVIEWER'], guards: ['actor'],
    effects: ['ASSIGN_REVIEWER', 'CREATE_AUDIT_EVENT'],
  },
  return: {
    action: 'return', from: ['IN_REVIEW'], nextStatus: 'READY_FOR_REVIEW', sources: ['USER'],
    guards: ['actor', 'assignedReviewer'], effects: ['RELEASE_REVIEWER', 'CREATE_AUDIT_EVENT'],
  },
  approve: {
    action: 'approve', from: ['IN_REVIEW'], nextStatus: 'APPROVED', sources: ['USER'],
    guards: ['actor', 'assignedReviewer', 'mfaReauthenticated'],
    effects: ['RECORD_MFA_REAUTHENTICATION', 'RELEASE_REVIEWER', 'CREATE_AUDIT_EVENT'],
  },
  reject: {
    action: 'reject', from: ['IN_REVIEW'], nextStatus: 'REJECTED', sources: ['USER'],
    guards: ['actor', 'assignedReviewer', 'rejectionReason'],
    effects: ['RELEASE_REVIEWER', 'CREATE_AUDIT_EVENT'],
  },
  resubmit: {
    action: 'resubmit', from: ['REJECTED'], nextStatus: 'READY_FOR_REVIEW', sources: ['USER'],
    roles: ['CLINICIAN'], guards: ['actor', 'currentVersion'],
    effects: ['CREATE_VERSION', 'CREATE_AUDIT_EVENT'],
  },
  amend: {
    action: 'amend', from: ['APPROVED'], nextStatus: 'AMENDED', sources: ['USER'],
    roles: ['CLINICIAN', 'ADMIN'], guards: ['actor', 'withinAmendmentGrace', 'currentVersion'],
    effects: ['CREATE_VERSION', 'CREATE_AUDIT_EVENT'],
  },
  grace_expired: {
    action: 'grace_expired', from: ['APPROVED'], nextStatus: 'LOCKED', sources: ['SCHEDULER'],
    effects: ['CREATE_AUDIT_EVENT'],
  },
};

const denied = (code: TransitionDenied['code'], reason: string): TransitionDenied => ({
  allowed: false,
  code,
  reason,
});

const hasRole = (actor: User | null, roles: readonly Role[]): boolean =>
  actor !== null && actor.roles.some((role) => roles.includes(role));

const isWithinGracePeriod = (note: Note, now: string): boolean => {
  if (note.approvedAt === null) return false;
  const approvedAt = Date.parse(note.approvedAt);
  const evaluatedAt = Date.parse(now);
  return Number.isFinite(approvedAt) && Number.isFinite(evaluatedAt)
    && evaluatedAt >= approvedAt && evaluatedAt - approvedAt <= AMENDMENT_GRACE_PERIOD_MS;
};

const evaluateGuard = (context: TransitionContext, action: TransitionAction, guard: Guard): TransitionDenied | null => {
  switch (guard) {
    case 'actor':
      return context.actor === null ? denied('ACTOR_REQUIRED', 'An authenticated actor is required.') : null;
    case 'assignedReviewer':
      return context.actor === null || context.note.assignedReviewerId !== context.actor.id
        ? denied('ASSIGNED_REVIEWER_REQUIRED', 'Only the assigned reviewer can perform this action.') : null;
    case 'rejectionReason':
      return action.type !== 'reject' || action.reason?.trim() === undefined || action.reason.trim() === ''
        ? denied('REJECTION_REASON_REQUIRED', 'A rejection reason is required.') : null;
    case 'mfaReauthenticated':
      return context.mfaReauthenticated ? null
        : denied('MFA_REAUTH_REQUIRED', 'MFA re-authentication is required before approval.');
    case 'withinAmendmentGrace':
      return isWithinGracePeriod(context.note, context.now) ? null
        : denied('AMENDMENT_GRACE_EXPIRED', 'The 24-hour amendment grace period has expired.');
    case 'currentVersion':
      return context.note.currentVersionId === null
        ? denied('CURRENT_VERSION_REQUIRED', 'A current version is required to create a successor.') : null;
  }
};

const buildEffects = (context: TransitionContext, action: TransitionAction, specification: TransitionSpecification): readonly TransitionEffect[] =>
  specification.effects.map((effect): TransitionEffect => {
    if (effect === 'ASSIGN_REVIEWER') return { type: effect, reviewerId: context.actor!.id };
    if (effect === 'RELEASE_REVIEWER') return { type: effect };
    if (effect === 'RECORD_MFA_REAUTHENTICATION') return { type: effect };
    if (effect === 'CREATE_AUDIT_EVENT') return { type: effect };
    return {
      type: effect,
      kind: action.type === 'amend' ? 'AMENDMENT' : 'RESUBMISSION',
      parentVersionId: context.note.currentVersionId!,
    };
  });

export const evaluateTransition = (context: TransitionContext, action: TransitionAction): TransitionDecision => {
  const specification = transitionSpecifications[action.type];
  if (!specification.from.includes(context.note.status)) {
    return denied('INVALID_STATUS', `${action.type} cannot be performed while a note is ${context.note.status}.`);
  }
  if (!specification.sources.includes(context.source)) {
    return denied('INVALID_SOURCE', `${action.type} cannot be initiated by ${context.source}.`);
  }
  if (specification.roles !== undefined && !hasRole(context.actor, specification.roles)) {
    return denied('ROLE_REQUIRED', 'The actor does not have the required role.');
  }
  for (const guard of specification.guards ?? []) {
    const guardFailure = evaluateGuard(context, action, guard);
    if (guardFailure !== null) return guardFailure;
  }
  return {
    allowed: true,
    nextStatus: specification.nextStatus,
    effects: buildEffects(context, action, specification),
    metadata: {
      action: action.type,
      source: context.source,
      fromStatus: context.note.status,
      requiresMfaReauthentication: specification.guards?.includes('mfaReauthenticated') ?? false,
    },
  };
};
