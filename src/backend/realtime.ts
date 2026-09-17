import type { NoteStatus, NoteVersion, ReviewEvent, Role } from '../domain';

export interface PresenceViewer { userId: string; displayName: string; role: Role; expiresAt: string }

export type RealtimeEvent =
  | { id: string; cursor: number; type: 'note.status_changed'; noteId: string; action: ReviewEvent['action']; fromStatus: NoteStatus; toStatus: NoteStatus; occurredAt: string }
  | { id: string; cursor: number; type: 'note.version_added'; noteId: string; version: NoteVersion; occurredAt: string }
  | { id: string; cursor: number; type: 'note.presence'; noteId: string; viewers: readonly PresenceViewer[]; occurredAt: string };

type Listener = (event: RealtimeEvent) => void;
type RealtimeEventInput =
  | { type: 'note.status_changed'; noteId: string; action: ReviewEvent['action']; fromStatus: NoteStatus; toStatus: NoteStatus; occurredAt: string }
  | { type: 'note.version_added'; noteId: string; version: NoteVersion; occurredAt: string }
  | { type: 'note.presence'; noteId: string; viewers: readonly PresenceViewer[]; occurredAt: string };

export class RealtimeEventBus {
  private cursor = 0; private readonly events: RealtimeEvent[] = []; private readonly listeners = new Set<Listener>(); private readonly presence = new Map<string, Map<string, PresenceViewer>>();
  publish(event: RealtimeEventInput): RealtimeEvent { const published = { ...event, id: `rt-${++this.cursor}`, cursor: this.cursor } as RealtimeEvent; this.events.push(published); if (this.events.length > 10_000) this.events.shift(); this.listeners.forEach((listener) => listener(published)); return published; }
  inject(event: RealtimeEvent): RealtimeEvent { this.cursor = Math.max(this.cursor, event.cursor); this.events.push(event); if (this.events.length > 10_000) this.events.shift(); this.listeners.forEach((listener) => listener(event)); return event; }
  since(cursor: number, noteIds: ReadonlySet<string>): readonly RealtimeEvent[] { return this.events.filter((event) => event.cursor > cursor && noteIds.has(event.noteId)); }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  join(noteId: string, viewer: PresenceViewer): void { const viewers = this.presence.get(noteId) ?? new Map<string, PresenceViewer>(); viewers.set(viewer.userId, viewer); this.presence.set(noteId, viewers); this.publish({ type: 'note.presence', noteId, viewers: [...viewers.values()], occurredAt: new Date().toISOString() }); }
  leave(noteId: string, userId: string): void { const viewers = this.presence.get(noteId); if (viewers === undefined) return; viewers.delete(userId); if (viewers.size === 0) this.presence.delete(noteId); this.publish({ type: 'note.presence', noteId, viewers: [...viewers.values()], occurredAt: new Date().toISOString() }); }
  viewers(noteId: string): readonly PresenceViewer[] { return [...(this.presence.get(noteId)?.values() ?? [])]; }
}

/** Test-only deterministic event control; production flows use publish(). */
export const testRealtime = {
  emit: (event: RealtimeEvent): RealtimeEvent => realtimeBus.inject(event),
  replay: (cursor: number, noteIds: readonly string[]): readonly RealtimeEvent[] => realtimeBus.since(cursor, new Set(noteIds)),
};

const pausedAcknowledgements = new Map<string, Promise<void>>();
const acknowledgementReleases = new Map<string, () => void>();
export const testAcknowledgements = {
  pause: (key: string): void => { if (!pausedAcknowledgements.has(key)) pausedAcknowledgements.set(key, new Promise<void>((resolve) => acknowledgementReleases.set(key, resolve))); },
  release: (key: string): void => { acknowledgementReleases.get(key)?.(); acknowledgementReleases.delete(key); pausedAcknowledgements.delete(key); },
  wait: async (key: string): Promise<void> => { await pausedAcknowledgements.get(key); },
};

export const realtimeBus = new RealtimeEventBus();
