import { describe, expect, it } from 'vitest';
import { RealtimeEventBus } from './realtime';
import { realtimeClient } from '../data/realtime-client';

describe('realtime resource stress', () => {
  it('does not retain presence from 500 sequential note visits', () => {
    const bus = new RealtimeEventBus();
    const reviewer = { userId: 'reviewer-1', displayName: 'Reviewer A', role: 'REVIEWER' as const, expiresAt: '2026-01-01T00:01:00.000Z' };
    for (let index = 1; index <= 500; index += 1) {
      const noteId = `note-${index}`;
      bus.join(noteId, reviewer);
      bus.leave(noteId, reviewer.userId);
      expect(bus.viewers(noteId)).toHaveLength(0);
    }
    expect(bus.viewers('note-1')).toHaveLength(0);
    expect(bus.viewers('note-500')).toHaveLength(0);
  });

  it('returns realtime subscriptions and listeners to baseline after 500 visits', () => {
    const originalEventSource = globalThis.EventSource;
    class TestEventSource { onerror: (() => void) | null = null; addEventListener(): void {} close(): void {} }
    Object.assign(globalThis, { EventSource: TestEventSource });
    try {
      realtimeClient.close(); const baseline = realtimeClient.getDiagnostics();
      for (let index = 1; index <= 500; index += 1) {
        const unsubscribe = realtimeClient.subscribe([`note-${index}`]);
        const removeListener = realtimeClient.onEvent(() => undefined);
        expect(realtimeClient.getDiagnostics().activeNoteSubscriptions).toBeLessThanOrEqual(1);
        removeListener(); unsubscribe();
      }
      const final = realtimeClient.getDiagnostics();
      expect(final.activeNoteSubscriptions).toBe(baseline.activeNoteSubscriptions);
      expect(final.subscribedNoteIds).toEqual(baseline.subscribedNoteIds);
      expect(final.listenerCount).toBe(baseline.listenerCount);
      expect(final.reconnectTimers).toBe(0);
    } finally { realtimeClient.close(); Object.assign(globalThis, { EventSource: originalEventSource }); }
  });
});
