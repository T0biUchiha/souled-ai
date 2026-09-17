import type { NoteVersion, SoapContent } from '../../domain';
import type { WorkingDraft } from './draft';

export interface VersionConflict { commonAncestor: NoteVersion | null; server: NoteVersion; local: WorkingDraft }
export type ConflictChoice = 'local' | 'server' | 'manual';

/** Shared conflict policy for online, offline, and future real-time reconciliation. */
export const resolveVersionConflict = (conflict: VersionConflict, choice: ConflictChoice, manualContent?: SoapContent): WorkingDraft => ({
  baseVersionId: conflict.server.id,
  content: choice === 'server' ? { ...conflict.server.content } : choice === 'manual' && manualContent !== undefined ? { ...manualContent } : { ...conflict.local.content },
});
