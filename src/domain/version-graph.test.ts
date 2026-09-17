import { describe, expect, it } from 'vitest';
import { validateVersion } from './version-graph';
import type { NoteVersion } from './types';

const parent: NoteVersion = {
  id: 'v1',
  noteId: 'note-1',
  parentVersionId: null,
  content: { subjective: '', objective: '', assessment: '', plan: '' },
  createdAt: '2026-09-17T00:00:00.000Z',
  createdById: 'user-1',
  amendmentReason: null,
};

describe('validateVersion', () => {
  it('allows branching child versions within the same note', () => {
    const child = { ...parent, id: 'v2', parentVersionId: parent.id };
    expect(validateVersion(child, [parent])).toEqual({ ok: true, value: child });
  });

  it('does not allow a version from another note to be a parent', () => {
    const child = { ...parent, id: 'v2', noteId: 'note-2', parentVersionId: parent.id };
    const result = validateVersion(child, [parent]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VERSION_NOTE_MISMATCH');
  });
});
