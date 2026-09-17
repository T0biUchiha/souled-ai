import { describe, expect, it } from 'vitest';
import { DummyBackendStore } from './store';
import type { SaveVersionRequest } from './contracts';
import type { User } from '../domain';

const clinician: User = { id: 'clinician-1', displayName: 'Clinician', roles: ['CLINICIAN'] };
const reviewer: User = { id: 'reviewer-4', displayName: 'Reviewer', roles: ['REVIEWER'] };
const now = (): string => '2026-09-17T12:00:00.000Z';
const versionRequest = (clientMutationId: string): SaveVersionRequest => ({
  baseVersionId: 'version-1-1', clientMutationId, actor: clinician,
  content: { subjective: 'Updated symptoms', objective: 'Stable', assessment: 'Follow up', plan: 'Review in two weeks' },
});

describe('DummyBackendStore', () => {
  it('seeds 5,000 notes deterministically and serves cursor pages', () => {
    const first = new DummyBackendStore({ now });
    const second = new DummyBackendStore({ now });
    const firstPage = first.listNotes({ limit: 3, sort: 'createdAt', direction: 'asc' });
    const samePage = second.listNotes({ limit: 3, sort: 'createdAt', direction: 'asc' });
    expect(firstPage.items).toHaveLength(3);
    expect(firstPage).toEqual(samePage);
    expect(firstPage.nextCursor).not.toBeNull();
    const nextPage = first.listNotes({ limit: 3, sort: 'createdAt', direction: 'asc', cursor: firstPage.nextCursor! });
    expect(nextPage.items.map((item) => item.id)).not.toContain(firstPage.items[0]!.id);
  });

  it('filters, searches, and stable-sorts on the server', () => {
    const store = new DummyBackendStore({ now });
    const filtered = store.listNotes({ statuses: ['FAILED'], patient: 'Jordan', search: 'follow-up', sort: 'patientName', direction: 'asc' });
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((item) => item.status === 'FAILED' && item.patientName.includes('Jordan'))).toBe(true);
    const sorted = store.listNotes({ limit: 20, sort: 'patientName', direction: 'asc' }).items;
    expect(sorted.map((item) => `${item.patientName}/${item.id}`)).toEqual([...sorted].map((item) => `${item.patientName}/${item.id}`).sort());
  });

  it('makes version writes idempotent by client mutation ID', () => {
    const store = new DummyBackendStore({ seedCount: 1, now });
    const initial = store.getNote('note-1');
    const first = store.saveVersion('note-1', versionRequest('mutation-1'));
    const retry = store.saveVersion('note-1', versionRequest('mutation-1'));
    expect(initial).toMatchObject({ ok: true });
    expect(first).toEqual(retry);
    expect(first).toMatchObject({ ok: true, data: { parentVersionId: 'version-1-1' } });
  });

  it('returns a conflict and common ancestor instead of overwriting a stale version', () => {
    const store = new DummyBackendStore({ seedCount: 1, now });
    store.saveVersion('note-1', versionRequest('mutation-1'));
    const stale = store.saveVersion('note-1', versionRequest('mutation-2'));
    expect(stale).toMatchObject({
      ok: false, status: 409,
      error: { error: 'version_conflict', current: { parentVersionId: 'version-1-1' }, commonAncestor: { id: 'version-1-1' } },
    });
  });

  it('enforces transitions on the server even if a client posts directly', () => {
    const store = new DummyBackendStore({ now });
    const forbidden = store.transition('note-3', { action: { type: 'start_review' }, actor: clinician });
    const allowed = store.transition('note-4', { action: { type: 'approve' }, actor: reviewer, mfaReauthenticated: true });
    expect(forbidden).toMatchObject({ ok: false, status: 403, error: { error: 'forbidden' } });
    expect(allowed).toMatchObject({ ok: true, data: { status: 'APPROVED', assignedReviewerId: null } });
  });
});
