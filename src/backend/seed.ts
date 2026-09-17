import type { Note, NoteStatus, NoteVersion, ReviewEvent, SoapContent } from '../domain';

export interface SeededNoteData {
  note: Note;
  patientName: string;
  version: NoteVersion;
  events: readonly ReviewEvent[];
}

const statuses: readonly NoteStatus[] = ['GENERATING', 'FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'AMENDED', 'LOCKED'];
const firstNames = ['Avery', 'Jordan', 'Morgan', 'Riley', 'Casey', 'Taylor', 'Cameron', 'Reese'];
const lastNames = ['Patel', 'Garcia', 'Kim', 'Smith', 'Nguyen', 'Brown', 'Wilson', 'Johnson'];

export const mulberry32 = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const isoAt = (index: number): string => new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString();

export const createSeedData = (count = 5_000): readonly SeededNoteData[] => {
  const random = mulberry32(42);
  return Array.from({ length: count }, (_, index) => {
    const status = statuses[index % statuses.length]!;
    const createdAt = isoAt(index);
    const patientName = `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]}`;
    const content: SoapContent = {
      subjective: `${patientName} reports follow-up symptoms ${index % 19}.`,
      objective: `Vital signs stable. Observation score ${Math.floor(random() * 100)}.`,
      assessment: `Clinical assessment for encounter ${index + 1}.`,
      plan: 'Continue treatment and schedule follow-up.',
    };
    const noteId = `note-${index + 1}`;
    const versionId = `version-${index + 1}-1`;
    const assignedReviewerId = status === 'IN_REVIEW' ? `reviewer-${(index % 12) + 1}` : null;
    const approvedAt = status === 'APPROVED' || status === 'LOCKED'
      ? new Date(Date.parse(createdAt) + 60 * 60 * 1000).toISOString() : null;
    const note: Note = {
      id: noteId, patientId: `patient-${(index % 2_000) + 1}`, encounterId: `encounter-${index + 1}`,
      status, currentVersionId: versionId, assignedReviewerId, approvedAt, createdAt,
      updatedAt: isoAt(index + 5), createdById: `clinician-${(index % 40) + 1}`,
    };
    const version: NoteVersion = {
      id: versionId, noteId, parentVersionId: null, content, createdAt, createdById: note.createdById,
      amendmentReason: null,
    };
    return { note, patientName, version, events: [] };
  });
};
