import type { ListNotesQuery } from '../../backend/contracts';

export interface NotesListUrlState extends ListNotesQuery {
  search: string;
  sort: NonNullable<ListNotesQuery['sort']>;
  direction: NonNullable<ListNotesQuery['direction']>;
}

export const defaultNotesListUrlState: NotesListUrlState = {
  search: '', sort: 'updatedAt', direction: 'desc', limit: 50,
};

export const parseNotesListUrlState = (params: URLSearchParams): NotesListUrlState => {
  const statusValue = params.get('status');
  const status = statusValue === null ? undefined : statusValue.split(',').filter(Boolean);
  const state: NotesListUrlState = {
    search: params.get('q') ?? '',
    sort: (params.get('sort') ?? defaultNotesListUrlState.sort) as NotesListUrlState['sort'],
    direction: params.get('direction') === 'asc' ? 'asc' : 'desc',
    limit: 50,
  };
  if (status !== undefined) state.statuses = status as NonNullable<NotesListUrlState['statuses']>;
  const reviewer = params.get('reviewer'); if (reviewer !== null) state.reviewerId = reviewer;
  const patient = params.get('patient'); if (patient !== null) state.patient = patient;
  const from = params.get('from'); if (from !== null) state.from = from;
  const to = params.get('to'); if (to !== null) state.to = to;
  return state;
};

export const notesListUrlParams = (state: NotesListUrlState): URLSearchParams => {
  const params = new URLSearchParams();
  if (state.statuses !== undefined) params.set('status', state.statuses.join(','));
  if (state.reviewerId !== undefined && state.reviewerId !== '') params.set('reviewer', state.reviewerId);
  if (state.patient !== undefined && state.patient !== '') params.set('patient', state.patient);
  if (state.from !== undefined && state.from !== '') params.set('from', state.from);
  if (state.to !== undefined && state.to !== '') params.set('to', state.to);
  if (state.search !== '') params.set('q', state.search);
  if (state.sort !== defaultNotesListUrlState.sort) params.set('sort', state.sort);
  if (state.direction !== defaultNotesListUrlState.direction) params.set('direction', state.direction);
  return params;
};

export const notesListQueryKey = (state: NotesListUrlState): readonly ['notes', NotesListUrlState] => ['notes', state];
