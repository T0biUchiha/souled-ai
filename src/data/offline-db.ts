import Dexie, { type EntityTable } from 'dexie';
import type { Note, NoteVersion, ReviewEvent } from '../domain';

export class ClinicalNoteDatabase extends Dexie {
  notes!: EntityTable<Note, 'id'>;
  noteVersions!: EntityTable<NoteVersion, 'id'>;
  reviewEvents!: EntityTable<ReviewEvent, 'id'>;

  constructor() {
    super('clinical-note-review');
    this.version(1).stores({
      notes: 'id, patientId, encounterId, status, updatedAt',
      noteVersions: 'id, noteId, parentVersionId, createdAt',
      reviewEvents: 'id, noteId, versionId, occurredAt, action',
    });
  }
}

export const offlineDb = new ClinicalNoteDatabase();
