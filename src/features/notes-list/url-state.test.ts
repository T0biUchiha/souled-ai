import { describe, expect, it } from 'vitest';
import { notesListQueryKey, notesListUrlParams, parseNotesListUrlState } from './url-state';

describe('Notes List URL state', () => {
  it('restores a deep-linked search, filters, and sort', () => {
    const state = parseNotesListUrlState(new URLSearchParams('q=follow-up&status=FAILED,REJECTED&reviewer=reviewer-2&patient=Avery&from=2026-01-01&to=2026-01-31&sort=patientName&direction=asc'));
    expect(state).toMatchObject({
      search: 'follow-up', statuses: ['FAILED', 'REJECTED'], reviewerId: 'reviewer-2', patient: 'Avery',
      from: '2026-01-01', to: '2026-01-31', sort: 'patientName', direction: 'asc',
    });
    expect(notesListUrlParams(state).toString()).toContain('q=follow-up');
  });

  it('uses the complete URL state in the server query key', () => {
    const first = parseNotesListUrlState(new URLSearchParams('q=Avery'));
    const second = parseNotesListUrlState(new URLSearchParams('q=Jordan'));
    expect(notesListQueryKey(first)).not.toEqual(notesListQueryKey(second));
  });
});
