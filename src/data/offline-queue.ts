import type { NoteVersion } from '../domain';
import type { SaveVersionRequest, TransitionRequest } from '../backend/contracts';
import { offlineDb, type QueuedMutation } from './offline-db';

const now = (): string => new Date().toISOString();

export const queueVersionSave = async (noteId: string, request: SaveVersionRequest): Promise<QueuedMutation> => {
  const existing = (await offlineDb.queuedMutations.filter((mutation) => mutation.noteId === noteId && mutation.operation === 'save_version' && mutation.status === 'PENDING').toArray()).at(-1);
  if (existing !== undefined) {
    const updated: QueuedMutation = { ...existing, payload: { ...request, clientMutationId: existing.id }, baseVersionId: request.baseVersionId };
    await offlineDb.queuedMutations.put(updated); return updated;
  }
  const mutation: QueuedMutation = { id: request.clientMutationId, noteId, operation: 'save_version', payload: request, baseVersionId: request.baseVersionId, createdAt: now(), retryCount: 0, status: 'PENDING', dependsOnMutationId: null, lastError: null };
  await offlineDb.queuedMutations.put(mutation); return mutation;
};

export const queueTransition = async (noteId: string, request: TransitionRequest, mutationId: string): Promise<QueuedMutation> => {
  const dependency = await offlineDb.queuedMutations.where('noteId').equals(noteId).last();
  const mutation: QueuedMutation = { id: mutationId, noteId, operation: 'transition', payload: request, baseVersionId: null, createdAt: now(), retryCount: 0, status: 'PENDING', dependsOnMutationId: dependency?.id ?? null, lastError: null };
  await offlineDb.queuedMutations.put(mutation); return mutation;
};

export interface ReplayExecutor { saveVersion(noteId: string, request: SaveVersionRequest): Promise<NoteVersion>; transition(noteId: string, request: TransitionRequest): Promise<unknown> }
export interface ReplayResult { replayed: number; total: number; conflict: { noteId: string; current: NoteVersion; commonAncestor: NoteVersion | null } | null }

export const replayQueue = async (executor: ReplayExecutor, onProgress?: (done: number, total: number) => void): Promise<ReplayResult> => {
  const pending = await offlineDb.queuedMutations.orderBy('createdAt').filter((mutation) => mutation.status === 'PENDING').toArray();
  let replayed = 0;
  for (const mutation of pending) {
    try {
      if (mutation.operation === 'save_version') await executor.saveVersion(mutation.noteId, mutation.payload as SaveVersionRequest);
      else await executor.transition(mutation.noteId, mutation.payload as TransitionRequest);
      await offlineDb.queuedMutations.delete(mutation.id); replayed += 1; onProgress?.(replayed, pending.length);
    } catch (error) {
      const apiError = error as { payload?: { error?: string } };
      if (apiError.payload?.error === 'version_conflict') {
        await offlineDb.transaction('rw', offlineDb.queuedMutations, async () => {
          await offlineDb.queuedMutations.update(mutation.id, { status: 'BLOCKED', lastError: 'version_conflict' });
          await offlineDb.queuedMutations.where('noteId').equals(mutation.noteId).modify((item) => { if (item.createdAt > mutation.createdAt) item.status = 'BLOCKED'; });
        });
        const payload = apiError.payload as { current: NoteVersion; commonAncestor: NoteVersion | null };
        return { replayed, total: pending.length, conflict: { noteId: mutation.noteId, current: payload.current, commonAncestor: payload.commonAncestor } };
      }
      await offlineDb.queuedMutations.update(mutation.id, { retryCount: mutation.retryCount + 1, lastError: error instanceof Error ? error.message : 'Replay failed' });
      return { replayed, total: pending.length, conflict: null };
    }
  }
  return { replayed, total: pending.length, conflict: null };
};

export const queuedMutationCount = (): Promise<number> => offlineDb.queuedMutations.where('status').anyOf('PENDING', 'BLOCKED', 'FAILED').count();
