import type { SoapContent } from '../domain';
import { offlineDb } from './offline-db';

export const saveDraft = async (noteId: string, baseVersionId: string, content: SoapContent): Promise<void> => {
  const current = await offlineDb.noteDrafts.get(noteId);
  const updatedAt = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
  await offlineDb.noteDrafts.put({ noteId, baseVersionId, content: { ...content }, updatedAt });
};
export const clearDraft = (noteId: string): Promise<void> => offlineDb.noteDrafts.delete(noteId);
