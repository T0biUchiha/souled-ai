import { describe, expect, it } from 'vitest';
import { resolveVersionConflict, type VersionConflict } from './conflict-resolution';

const conflict: VersionConflict = {
  commonAncestor: null,
  server: { id: 'server-v2', noteId: 'n', parentVersionId: 'v1', content: { subjective: 'server', objective: '', assessment: '', plan: '' }, createdAt: '', createdById: 'r', amendmentReason: null },
  local: { baseVersionId: 'v1', content: { subjective: 'local edit', objective: '', assessment: '', plan: '' } },
};
describe('conflict resolution', () => {
  it('keeps local edits and targets the server head when local is accepted', () => expect(resolveVersionConflict(conflict, 'local')).toEqual({ baseVersionId: 'server-v2', content: conflict.local.content }));
  it('allows a manual section merge without automatic overwrite', () => expect(resolveVersionConflict(conflict, 'manual', { ...conflict.local.content, subjective: 'merged' })).toMatchObject({ baseVersionId: 'server-v2', content: { subjective: 'merged' } }));
});
