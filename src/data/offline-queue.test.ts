import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../domain';
import { offlineDb } from './offline-db';
import { completeReplayConflict, queueTransition, queueVersionSave, replayQueue } from './offline-queue';

const clinician: User = { id: 'c1', displayName: 'Clinician', roles: ['CLINICIAN'] };
const request = (id: string) => ({ baseVersionId: 'v1', clientMutationId: id, actor: clinician, content: { subjective: id, objective: '', assessment: '', plan: '' } });
describe('persistent offline queue', () => {
  beforeEach(async () => { await offlineDb.queuedMutations.clear(); });
  it('persists and coalesces offline edits without changing the original mutation ID', async () => { await queueVersionSave('note-1', request('m1')); await queueVersionSave('note-1', request('m2')); const queued = await offlineDb.queuedMutations.toArray(); expect(queued).toHaveLength(1); expect(queued[0]).toMatchObject({ id: 'm1', payload: { clientMutationId: 'm1', content: { subjective: 'm2' } } }); });
  it('replays queued writes in order after reconnect', async () => { await queueVersionSave('note-1', request('m1')); const calls: string[] = []; const result = await replayQueue({ saveVersion: async (_noteId, payload) => { calls.push(payload.clientMutationId); return { id: 'v2', noteId: 'note-1', parentVersionId: 'v1', content: payload.content, createdAt: '', createdById: 'c1', amendmentReason: null }; }, transition: async () => undefined }); expect(result.replayed).toBe(1); expect(calls).toEqual(['m1']); expect(await offlineDb.queuedMutations.count()).toBe(0); });
  it('keeps dependent commands blocked until a replacement conflict save is confirmed', async () => {
    await queueVersionSave('note-1', request('m1'));
    await queueTransition('note-1', { action: { type: 'resubmit' }, actor: clinician }, 'm2');
    const conflict = await replayQueue({ saveVersion: async () => { throw { payload: { error: 'version_conflict', current: { id: 'v2' }, commonAncestor: null } }; }, transition: async () => undefined });
    expect(conflict.conflict?.mutationId).toBe('m1');
    expect((await offlineDb.queuedMutations.get('m2'))?.status).toBe('BLOCKED');
    await completeReplayConflict('note-1', 'm1');
    expect(await offlineDb.queuedMutations.get('m1')).toBeUndefined();
    expect((await offlineDb.queuedMutations.get('m2'))?.status).toBe('PENDING');
  });
});
