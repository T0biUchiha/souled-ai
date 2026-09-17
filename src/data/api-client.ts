import type {
  ApiError, BulkRequest, BulkResult, ListNotesQuery, NoteDetail, NotePage, SaveVersionRequest, TransitionRequest, TransitionResponse,
} from '../backend/contracts';
import type { NoteVersion } from '../domain';
import { offlineDb } from './offline-db';

export class ApiClientError extends Error {
  constructor(readonly status: number, readonly payload: ApiError) {
    super('message' in payload ? payload.message : 'The note version has changed on the server.');
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body: unknown = await response.json();
  if (!response.ok) throw new ApiClientError(response.status, body as ApiError);
  return body as T;
};

const queryString = (query: ListNotesQuery): string => {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.statuses !== undefined) params.set('status', query.statuses.join(','));
  for (const key of ['reviewerId', 'patient', 'from', 'to', 'search', 'sort', 'direction'] as const) {
    const value = query[key]; if (value !== undefined) params.set(key === 'reviewerId' ? 'reviewer' : key, value);
  }
  const encoded = params.toString(); return encoded === '' ? '' : `?${encoded}`;
};

export const noteApi = {
  list: (query: ListNotesQuery = {}, signal?: AbortSignal): Promise<NotePage> => request(`/notes${queryString(query)}`, signal === undefined ? undefined : { signal }),
  get: async (noteId: string): Promise<NoteDetail> => {
    if (!navigator.onLine) { const cached = await offlineDb.noteSnapshots.get(noteId); if (cached !== undefined) return cached; }
    const detail = await request<NoteDetail>(`/notes/${encodeURIComponent(noteId)}`);
    await offlineDb.noteSnapshots.put(detail); return detail;
  },
  saveVersion: (noteId: string, payload: SaveVersionRequest): Promise<NoteVersion> => request(`/notes/${encodeURIComponent(noteId)}/versions`, { method: 'POST', body: JSON.stringify(payload) }),
  transition: (noteId: string, payload: TransitionRequest): Promise<TransitionResponse> => request(`/notes/${encodeURIComponent(noteId)}/transitions`, { method: 'POST', body: JSON.stringify(payload) }),
  bulk: (payload: BulkRequest): Promise<BulkResult> => request('/notes/bulk', { method: 'POST', body: JSON.stringify(payload) }),
  seed: (count = 5_000): Promise<{ count: number }> => request('/dev/seed', { method: 'POST', body: JSON.stringify({ count }) }),
  reset: (): Promise<{ ok: boolean }> => request('/dev/reset', { method: 'POST' }),
};
