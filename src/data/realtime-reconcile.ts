import type { Note, NoteVersion } from '../domain';
import { transitionSpecifications } from '../domain';
import type { RealtimeEvent } from '../backend/realtime';

/** Idempotent cache reconciliation; server events are authoritative but must match the lifecycle contract. */
export const reconcileRealtimeNote = (note: Note, event: RealtimeEvent): Note => {
  if (event.type !== 'note.status_changed' || note.status === event.toStatus) return note;
  const specification = transitionSpecifications[event.action as keyof typeof transitionSpecifications];
  if (specification === undefined || note.status !== event.fromStatus || specification.nextStatus !== event.toStatus) return note;
  return { ...note, status: event.toStatus, updatedAt: event.occurredAt };
};

export const hasSupersedingVersion = (baseVersionId: string, event: RealtimeEvent): event is Extract<RealtimeEvent, { type: 'note.version_added' }> => event.type === 'note.version_added' && event.version.id !== baseVersionId;

export const mergeRealtimeVersion = (versions: readonly NoteVersion[], version: NoteVersion): readonly NoteVersion[] => versions.some((item) => item.id === version.id) ? versions : [version, ...versions];
