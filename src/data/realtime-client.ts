import type { RealtimeEvent } from '../backend/realtime';

type Listener = (event: RealtimeEvent) => void;
const cursorKey = 'clinical-note-realtime-cursor';

export class RealtimeClient {
  private source: EventSource | null = null; private readonly noteRefs = new Map<string, number>(); private readonly listeners = new Set<Listener>(); private retry = 0; private timer: ReturnType<typeof setTimeout> | null = null;
  subscribe(noteIds: readonly string[]): () => void { noteIds.forEach((id) => this.noteRefs.set(id, (this.noteRefs.get(id) ?? 0) + 1)); this.connect(); return () => { noteIds.forEach((id) => { const next = (this.noteRefs.get(id) ?? 1) - 1; if (next <= 0) this.noteRefs.delete(id); else this.noteRefs.set(id, next); }); this.connect(); }; }
  onEvent(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close(): void { if (this.timer !== null) clearTimeout(this.timer); this.source?.close(); this.source = null; }
  private connect(): void {
    this.source?.close(); this.source = null; if (this.noteRefs.size === 0 || !navigator.onLine) return;
    const cursor = localStorage.getItem(cursorKey) ?? '0'; this.source = new EventSource(`/api/events?notes=${encodeURIComponent([...this.noteRefs.keys()].join(','))}&cursor=${cursor}`);
    const receive = (event: MessageEvent<string>) => { const data = JSON.parse(event.data) as RealtimeEvent; localStorage.setItem(cursorKey, String(data.cursor)); this.retry = 0; this.listeners.forEach((listener) => listener(data)); };
    ['note.status_changed', 'note.version_added', 'note.presence'].forEach((type) => this.source?.addEventListener(type, receive as EventListener));
    this.source.onerror = () => { this.source?.close(); const delay = Math.min(30_000, 500 * 2 ** this.retry) + Math.floor(Math.random() * 250); this.retry += 1; this.timer = setTimeout(() => this.connect(), delay); };
  }
}

export const realtimeClient = new RealtimeClient();
