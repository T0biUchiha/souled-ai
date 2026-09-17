import type { PresenceViewer, RealtimeEvent } from '../../backend/realtime';

export const otherViewers = (event: Extract<RealtimeEvent, { type: 'note.presence' }> | null, noteId: string, currentUserId: string): readonly PresenceViewer[] =>
  event === null || event.noteId !== noteId ? [] : [...new Map(event.viewers.filter((viewer) => viewer.userId !== currentUserId).map((viewer) => [viewer.userId, viewer])).values()];

export const presenceLabel = (viewers: readonly PresenceViewer[]): string => viewers.length === 0 ? 'No other reviewers viewing' : viewers.length === 1 ? `${viewers[0]!.displayName} is viewing` : `${viewers[0]!.displayName} and ${viewers.length - 1} other reviewer${viewers.length === 2 ? '' : 's'} are viewing`;
