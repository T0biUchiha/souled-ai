import { err, ok, type Result } from './result';
import type { NoteVersion } from './types';

export const validateVersion = (
  version: NoteVersion,
  knownVersions: readonly NoteVersion[],
): Result<NoteVersion> => {
  if (version.parentVersionId === null) return ok(version);
  if (version.parentVersionId === version.id) {
    return err('VERSION_CYCLE', 'A version cannot be its own parent.');
  }
  const parent = knownVersions.find((candidate) => candidate.id === version.parentVersionId);
  if (parent === undefined) return err('VERSION_NOT_FOUND', 'The parent version does not exist.');
  if (parent.noteId !== version.noteId) {
    return err('VERSION_NOTE_MISMATCH', 'A version parent must belong to the same note.');
  }
  return ok(version);
};
