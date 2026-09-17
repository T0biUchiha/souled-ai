import { evaluateTransition, transitionSpecifications, type TransitionAction, type TransitionContext } from './state-machine';

export interface ActionPresentation {
  action: TransitionAction['type'];
  visible: boolean;
  enabled: boolean;
  disabledReason: string | null;
}

const actionInput = (type: TransitionAction['type']): TransitionAction => {
  if (type === 'reject') return { type, reason: '' };
  return { type };
};

/** UI code consumes these derived decisions instead of interpreting note status itself. */
export const selectActions = (
  context: TransitionContext,
  actionInputs: Partial<Record<TransitionAction['type'], TransitionAction>> = {},
): readonly ActionPresentation[] =>
  Object.values(transitionSpecifications)
    .filter((specification) => specification.from.includes(context.note.status) && specification.sources.includes(context.source))
    .map((specification) => {
      const decision = evaluateTransition(context, actionInputs[specification.action] ?? actionInput(specification.action));
      const roleVisible = specification.roles === undefined
        || (context.actor !== null && context.actor.roles.some((role) => specification.roles!.includes(role)));
      return {
        action: specification.action,
        visible: roleVisible,
        enabled: decision.allowed,
        disabledReason: decision.allowed ? null : decision.reason,
      };
    });

export const isNoteReadOnly = (context: TransitionContext): boolean =>
  !selectActions(context).some((action) => action.enabled);
