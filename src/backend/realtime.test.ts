import { describe, expect, it } from 'vitest';
import { RealtimeEventBus } from './realtime';

const reviewer = { userId: 'reviewer-1', displayName: 'Dr. Chen', role: 'REVIEWER' as const, expiresAt: '2026-01-01T00:01:00.000Z' };

describe('presence event bus', () => {
  it('deduplicates joins and broadcasts join/leave state', () => {
    const bus = new RealtimeEventBus(); const events: unknown[] = []; bus.subscribe((event) => events.push(event));
    bus.join('note-1', reviewer); bus.join('note-1', reviewer);
    expect(bus.viewers('note-1')).toEqual([reviewer]);
    bus.leave('note-1', reviewer.userId);
    expect(bus.viewers('note-1')).toEqual([]);
    expect(events).toHaveLength(3);
  });

  it('keeps viewers isolated when switching notes', () => {
    const bus = new RealtimeEventBus(); bus.join('note-1', reviewer); bus.join('note-2', { ...reviewer, userId: 'reviewer-2' }); bus.leave('note-1', reviewer.userId);
    expect(bus.viewers('note-1')).toEqual([]); expect(bus.viewers('note-2')).toHaveLength(1);
  });
});
