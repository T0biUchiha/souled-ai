import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeEvent } from '../backend/realtime';
import { mergeRealtimeVersion, reconcileRealtimeNote } from './realtime-reconcile';
import { RealtimeClient } from './realtime-client';
import type { Note, NoteVersion } from '../domain';

const note: Note = { id: 'n', patientId: 'p', encounterId: 'e', status: 'READY_FOR_REVIEW', currentVersionId: 'v1', assignedReviewerId: null, approvedAt: null, createdAt: '', updatedAt: '', createdById: 'c' };
const version: NoteVersion = { id: 'v2', noteId: 'n', parentVersionId: 'v1', content: { subjective: '', objective: '', assessment: '', plan: '' }, createdAt: '', createdById: 'c', amendmentReason: null };
describe('realtime reconciliation', () => {
  it('deduplicates duplicate versions', () => expect(mergeRealtimeVersion([version], version)).toEqual([version]));
  it('ignores out-of-order status events', () => expect(reconcileRealtimeNote(note, { id: 'e', cursor: 1, type: 'note.status_changed', noteId: 'n', action: 'approve', fromStatus: 'IN_REVIEW', toStatus: 'APPROVED', occurredAt: '' })).toEqual(note));
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, EventListener>();
  onerror: ((this: EventSource, event: Event) => void) | null = null;
  readonly readyState = 1;
  readonly withCredentials = false;
  closed = false;

  constructor(readonly url: string) { MockEventSource.instances.push(this); }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void { this.listeners.set(type, listener as EventListener); }
  removeEventListener(type: string): void { this.listeners.delete(type); }
  close(): void { this.closed = true; }
  dispatchEvent(): boolean { return true; }
  emit(type: RealtimeEvent['type'], data: RealtimeEvent): void {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const statusEvent = (cursor: number): RealtimeEvent => ({
  id: `event-${cursor}`,
  cursor,
  type: 'note.status_changed',
  noteId: 'note-1',
  action: 'start_review',
  fromStatus: 'READY_FOR_REVIEW',
  toStatus: 'IN_REVIEW',
  occurredAt: '2026-01-01T00:00:00.000Z',
});

describe('RealtimeClient reconnect and missed-event replay', () => {
  const originalEventSource = globalThis.EventSource;

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    MockEventSource.instances = [];
    localStorage.clear();
    vi.useRealTimers();
  });

  it('reconnects from its last event cursor and delivers replayed events once', () => {
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    const client = new RealtimeClient();
    const received: RealtimeEvent[] = [];
    const stopListening = client.onEvent((event) => received.push(event));
    const stopSubscription = client.subscribe(['note-1']);

    const firstConnection = MockEventSource.instances[0]!;
    expect(firstConnection.url).toContain('notes=note-1');
    expect(firstConnection.url).toContain('cursor=0');
    firstConnection.emit('note.status_changed', statusEvent(10));
    expect(received.map((event) => event.id)).toEqual(['event-10']);

    client.testDisconnect();
    expect(firstConnection.closed).toBe(true);
    client.testReconnect();

    const reconnect = MockEventSource.instances[1]!;
    expect(reconnect.url).toContain('cursor=10');
    reconnect.emit('note.status_changed', statusEvent(11));
    expect(received.map((event) => event.id)).toEqual(['event-10', 'event-11']);
    expect(client.getDiagnostics()).toMatchObject({
      activeNoteSubscriptions: 1,
      subscribedNoteIds: ['note-1'],
      listenerCount: 1,
      reconnectTimers: 0,
    });

    stopSubscription();
    stopListening();
    client.close();
    expect(client.getDiagnostics()).toMatchObject({
      activeNoteSubscriptions: 0,
      subscribedNoteIds: [],
      listenerCount: 0,
      reconnectTimers: 0,
    });
  });
});
