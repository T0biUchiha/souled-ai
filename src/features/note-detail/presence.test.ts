import { describe, expect, it } from 'vitest';
import { otherViewers, presenceLabel } from './presence';

const event = { id: 'presence-1', cursor: 1, type: 'note.presence' as const, noteId: 'note-1', occurredAt: '', viewers: [
  { userId: 'self', displayName: 'Me', role: 'REVIEWER' as const, expiresAt: '' },
  { userId: 'reviewer-2', displayName: 'Dr. Chen', role: 'REVIEWER' as const, expiresAt: '' },
  { userId: 'reviewer-2', displayName: 'Dr. Chen', role: 'REVIEWER' as const, expiresAt: '' },
] };

describe('presence selectors', () => {
  it('excludes self and deduplicates viewers', () => {
    const viewers = otherViewers(event, 'note-1', 'self');
    expect(viewers).toHaveLength(1); expect(presenceLabel(viewers)).toBe('Dr. Chen is viewing');
  });
  it('ignores a presence event for another note', () => expect(otherViewers(event, 'note-2', 'self')).toEqual([]));
});
