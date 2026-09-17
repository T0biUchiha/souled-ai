import type { NoteStatus, NoteVersion, ReviewEvent } from '../domain';

export type RealtimeEvent =
  | { id: string; cursor: number; type: 'note.status_changed'; noteId: string; action: ReviewEvent['action']; fromStatus: NoteStatus; toStatus: NoteStatus; occurredAt: string }
  | { id: string; cursor: number; type: 'note.version_added'; noteId: string; version: NoteVersion; occurredAt: string }
  | { id: string; cursor: number; type: 'note.presence'; noteId: string; viewers: readonly { userId: string; displayName: string; expiresAt: string }[]; occurredAt: string };

type Listener = (event: RealtimeEvent) => void;
type RealtimeEventInput =
  | { type: 'note.status_changed'; noteId: string; action: ReviewEvent['action']; fromStatus: NoteStatus; toStatus: NoteStatus; occurredAt: string }
  | { type: 'note.version_added'; noteId: string; version: NoteVersion; occurredAt: string }
  | { type: 'note.presence'; noteId: string; viewers: readonly { userId: string; displayName: string; expiresAt: string }[]; occurredAt: string };

export class RealtimeEventBus {
  private cursor = 0; private readonly events: RealtimeEvent[] = []; private readonly listeners = new Set<Listener>();
  publish(event: RealtimeEventInput): RealtimeEvent { const published = { ...event, id: `rt-${++this.cursor}`, cursor: this.cursor } as RealtimeEvent; this.events.push(published); if (this.events.length > 10_000) this.events.shift(); this.listeners.forEach((listener) => listener(published)); return published; }
  since(cursor: number, noteIds: ReadonlySet<string>): readonly RealtimeEvent[] { return this.events.filter((event) => event.cursor > cursor && noteIds.has(event.noteId)); }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

export const realtimeBus = new RealtimeEventBus();
