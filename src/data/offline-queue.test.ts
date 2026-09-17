import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../domain';
import { offlineDb } from './offline-db';
import { queueVersionSave, replayQueue } from './offline-queue';

const clinician: User = { id: 'c1', displayName: 'Clinician', roles: ['CLINICIAN'] };
const request = (id: string) => ({ baseVersionId: 'v1', clientMutationId: id, actor: clinician, content: { subjective: id, objective: '', assessment: '', plan: '' } });
describe('persistent offline queue', () => {
  beforeEach(async () => { await offlineDb.queuedMutations.clear(); });
  it('persists and coalesces offline edits without changing the original mutation ID', async () => { await queueVersionSave('note-1', request('m1')); await queueVersionSave('note-1', request('m2')); const queued = await offlineDb.queuedMutations.toArray(); expect(queued).toHaveLength(1); expect(queued[0]).toMatchObject({ id: 'm1', payload: { clientMutationId: 'm1', content: { subjective: 'm2' } } }); });
  it('replays queued writes in order after reconnect', async () => { await queueVersionSave('note-1', request('m1')); const calls: string[] = []; const result = await replayQueue({ saveVersion: async (_noteId, payload) => { calls.push(payload.clientMutationId); return { id: 'v2', noteId: 'note-1', parentVersionId: 'v1', content: payload.content, createdAt: '', createdById: 'c1', amendmentReason: null }; }, transition: async () => undefined }); expect(result.replayed).toBe(1); expect(calls).toEqual(['m1']); expect(await offlineDb.queuedMutations.count()).toBe(0); });
});
