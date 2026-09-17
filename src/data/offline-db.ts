import Dexie, { type EntityTable } from 'dexie';
import type { Note, NoteVersion, ReviewEvent } from '../domain';
import type { NoteDetail, SaveVersionRequest, TransitionRequest } from '../backend/contracts';
import type { SoapContent } from '../domain';

export type QueuedMutation = {
  id: string;
  noteId: string;
  operation: 'save_version' | 'transition';
  payload: SaveVersionRequest | TransitionRequest;
  baseVersionId: string | null;
  createdAt: string;
  retryCount: number;
  status: 'PENDING' | 'BLOCKED' | 'FAILED';
  dependsOnMutationId: string | null;
  lastError: string | null;
};
export type PersistedTelemetryBatch = { id: string; events: readonly unknown[]; attempts: number; createdAt: string; lastError: string | null };
export type PersistedNoteDraft = { noteId: string; baseVersionId: string; content: SoapContent; updatedAt: number };

export class ClinicalNoteDatabase extends Dexie {
  notes!: EntityTable<Note, 'id'>;
  noteVersions!: EntityTable<NoteVersion, 'id'>;
  reviewEvents!: EntityTable<ReviewEvent, 'id'>;
  queuedMutations!: EntityTable<QueuedMutation, 'id'>;
  noteSnapshots!: EntityTable<NoteDetail, 'id'>;
  telemetryBatches!: EntityTable<PersistedTelemetryBatch, 'id'>;
  noteDrafts!: EntityTable<PersistedNoteDraft, 'noteId'>;

  constructor() {
    super('clinical-note-review');
    this.version(1).stores({
      notes: 'id, patientId, encounterId, status, updatedAt',
      noteVersions: 'id, noteId, parentVersionId, createdAt',
      reviewEvents: 'id, noteId, versionId, occurredAt, action',
    });
    this.version(2).stores({
      notes: 'id, patientId, encounterId, status, updatedAt',
      noteVersions: 'id, noteId, parentVersionId, createdAt',
      reviewEvents: 'id, noteId, versionId, occurredAt, action',
      queuedMutations: 'id, noteId, createdAt, status, dependsOnMutationId',
      noteSnapshots: 'id, updatedAt',
    });
    this.version(3).stores({
      notes: 'id, patientId, encounterId, status, updatedAt', noteVersions: 'id, noteId, parentVersionId, createdAt', reviewEvents: 'id, noteId, versionId, occurredAt, action', queuedMutations: 'id, noteId, createdAt, status, dependsOnMutationId', noteSnapshots: 'id, updatedAt', telemetryBatches: 'id, createdAt',
    });
    this.version(4).stores({
      notes: 'id, patientId, encounterId, status, updatedAt', noteVersions: 'id, noteId, parentVersionId, createdAt', reviewEvents: 'id, noteId, versionId, occurredAt, action', queuedMutations: 'id, noteId, createdAt, status, dependsOnMutationId', noteSnapshots: 'id, updatedAt', telemetryBatches: 'id, createdAt', noteDrafts: 'noteId, updatedAt',
    });
  }
}

export const offlineDb = new ClinicalNoteDatabase();
