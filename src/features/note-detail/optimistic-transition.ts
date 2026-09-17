import { evaluateTransition, type Note, type ReviewEvent, type TransitionAction, type TransitionContext } from '../../domain';

export interface OptimisticTransition { previousNote: Note; optimisticNote: Note; temporaryEvent: ReviewEvent }

export const beginOptimisticTransition = (context: TransitionContext, action: TransitionAction, temporaryEventId: string): OptimisticTransition | null => {
  const decision = evaluateTransition(context, action);
  if (!decision.allowed) return null;
  const assigned = decision.effects.find((effect) => effect.type === 'ASSIGN_REVIEWER');
  const released = decision.effects.some((effect) => effect.type === 'RELEASE_REVIEWER');
  const optimisticNote: Note = { ...context.note, status: decision.nextStatus, updatedAt: context.now, assignedReviewerId: assigned?.type === 'ASSIGN_REVIEWER' ? assigned.reviewerId : released ? null : context.note.assignedReviewerId };
  return {
    previousNote: context.note, optimisticNote,
    temporaryEvent: { id: temporaryEventId, noteId: context.note.id, versionId: context.note.currentVersionId, action: action.type, actorId: context.actor?.id ?? 'system', occurredAt: context.now, fromStatus: context.note.status, toStatus: decision.nextStatus, reason: action.type === 'reject' || action.type === 'amend' ? action.reason?.trim() || null : null, metadata: { optimistic: true } },
  };
};

export const reconcileTransitionEvents = (events: readonly ReviewEvent[], temporaryEventId: string, serverEvent: ReviewEvent): readonly ReviewEvent[] =>
  events.map((event) => event.id === temporaryEventId ? serverEvent : event);

export const rollbackTransitionEvent = (events: readonly ReviewEvent[], temporaryEventId: string): readonly ReviewEvent[] =>
  events.filter((event) => event.id !== temporaryEventId);
