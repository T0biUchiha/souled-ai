import { useVirtualizer } from '@tanstack/react-virtual';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { NoteStatus } from '../../domain';
import type { NoteSummary } from '../../backend/contracts';
import type { BulkRequest, NotePage } from '../../backend/contracts';
import { noteApi } from '../../data/api-client';
import { useRealtimeNotes } from '../../data/use-realtime-notes';
import { parseNotesListUrlState, notesListUrlParams, type NotesListUrlState } from './url-state';
import { useNotesList } from './use-notes-list';
import './notes-list.css';

const allStatuses: readonly NoteStatus[] = ['GENERATING', 'FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'AMENDED', 'LOCKED'];
const columns: ReadonlyArray<{ key: 'patientName' | 'status' | 'updatedAt' | 'createdAt'; label: string }> = [
  { key: 'patientName', label: 'Patient' }, { key: 'status', label: 'Status' }, { key: 'updatedAt', label: 'Updated' }, { key: 'createdAt', label: 'Created' },
];

const NoteRow = memo(function NoteRow({ note, selected, pending, onToggle, style, index }: { note: NoteSummary; selected: boolean; pending: boolean; onToggle: (id: string) => void; style: React.CSSProperties; index: number }) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const adjacent = document.querySelector<HTMLElement>(`[data-note-index="${index + (event.key === 'ArrowDown' ? 1 : -1)}"]`);
    adjacent?.focus();
  };
  return <div aria-busy={pending} aria-rowindex={index + 2} className="notes-row" data-note-index={index} role="row" style={style} tabIndex={0} onKeyDown={onKeyDown}>
    <div role="gridcell"><input aria-label={`Select ${note.patientName}`} checked={selected} onChange={() => onToggle(note.id)} type="checkbox" /></div>
    <div role="gridcell"><Link to={`/notes/${note.id}`}>{note.patientName}</Link></div><div role="gridcell"><span className="status-pill">{note.status}</span></div>
    <div role="gridcell">{new Date(note.updatedAt).toLocaleString()}</div><div role="gridcell">{new Date(note.createdAt).toLocaleDateString()}</div>
  </div>;
});

export function NotesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseNotesListUrlState(searchParams), [searchParams]);
  const updateUrl = useCallback((patch: Partial<NotesListUrlState>) => setSearchParams(notesListUrlParams({ ...state, ...patch })), [setSearchParams, state]);
  const { data, error, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, status } = useNotesList(state);
  const notes = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [reviewerId, setReviewerId] = useState('reviewer-1');
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const queryClient = useQueryClient();
  const bulkMutation = useMutation({
    mutationFn: (request: BulkRequest) => noteApi.bulk(request),
    onMutate: (request) => setPendingIds(new Set(request.noteIds)),
    onSuccess: (result) => {
      const byId = new Map(result.updated.map((item) => [item.id, item]));
      queryClient.setQueriesData<InfiniteData<NotePage>>({ queryKey: ['notes'] }, (previous) => previous === undefined ? previous : {
        ...previous,
        pages: previous.pages.map((page) => ({ ...page, items: page.items.map((item) => ({ ...item, ...(byId.get(item.id) ?? {}) })) })),
      });
      setSelectedIds(new Set());
    },
    onSettled: () => setPendingIds(new Set()),
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: notes.length, getScrollElement: () => parentRef.current, estimateSize: () => 48, overscan: 8 });
  const virtualRows = virtualizer.getVirtualItems();
  useRealtimeNotes(useMemo(() => virtualRows.map((row) => notes[row.index]!.id), [notes, virtualRows]));
  useEffect(() => {
    const last = virtualRows.at(-1);
    if (last !== undefined && last.index >= notes.length - 8 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, notes.length, virtualRows]);
  const toggle = useCallback((id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const updateSort = (sort: NotesListUrlState['sort']) => updateUrl({ sort, direction: state.sort === sort && state.direction === 'desc' ? 'asc' : 'desc' });
  const runBulk = (operation: BulkRequest['operation']) => bulkMutation.mutate({ operation, noteIds: [...selectedIds], reviewerId, actor: { id: 'clinician-1', displayName: 'Demo clinician', roles: ['CLINICIAN'] } });
  const initialLoading = status === 'pending';
  const hasFilters = state.search !== '' || state.statuses !== undefined || state.patient !== undefined || state.reviewerId !== undefined || state.from !== undefined || state.to !== undefined;

  return <section aria-labelledby="notes-title">
    <h1 id="notes-title">Notes</h1>
    <div className="notes-filters" role="search">
      <label>Search <input aria-label="Search notes" onChange={(event) => updateUrl({ search: event.target.value })} placeholder="Patient or note content" value={state.search} /></label>
      <label>Status <select aria-label="Status filter" multiple onChange={(event) => updateUrl({ statuses: [...event.target.selectedOptions].map((option) => option.value as NoteStatus) })} value={state.statuses ?? []}>{allStatuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>Reviewer <input aria-label="Reviewer filter" onChange={(event) => updateUrl({ reviewerId: event.target.value })} value={state.reviewerId ?? ''} /></label>
      <label>Patient <input aria-label="Patient filter" onChange={(event) => updateUrl({ patient: event.target.value })} value={state.patient ?? ''} /></label>
      <label>From <input aria-label="From date" onChange={(event) => updateUrl({ from: event.target.value })} type="date" value={state.from ?? ''} /></label>
      <label>To <input aria-label="To date" onChange={(event) => updateUrl({ to: event.target.value })} type="date" value={state.to ?? ''} /></label>
    </div>
    <div className="bulk-toolbar"><p aria-live="polite">{selectedIds.size} selected across loaded pages.</p><label>Assign reviewer <input onChange={(event) => setReviewerId(event.target.value)} value={reviewerId} /></label><button disabled={selectedIds.size === 0 || bulkMutation.isPending} onClick={() => runBulk('assign_reviewer')} type="button">Assign reviewer</button><button disabled={selectedIds.size === 0 || bulkMutation.isPending} onClick={() => runBulk('regenerate')} type="button">Request regeneration</button></div>
    {initialLoading ? <div aria-label="Loading notes" className="notes-skeleton">Loading notes…</div> : null}
    {status === 'error' ? <div role="alert">Could not load notes: {error.message}</div> : null}
    {!initialLoading && status === 'success' && notes.length === 0 ? <div className="notes-empty" role="status"><h2>{hasFilters ? 'No matching notes' : 'No notes yet'}</h2><p>{hasFilters ? 'Try changing or clearing the current search and filters.' : 'Notes will appear here when generation begins.'}</p></div> : null}
    {notes.length > 0 ? <div aria-label="Notes results" className="notes-grid" ref={parentRef} role="grid">
      <div className="notes-header" role="row"><div role="columnheader">Select</div>{columns.map((column) => <button aria-sort={state.sort === column.key ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none'} key={column.key} onClick={() => updateSort(column.key)} role="columnheader" type="button">{column.label}</button>)}</div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>{virtualRows.map((row) => { const note = notes[row.index]!; return <NoteRow index={row.index} key={note.id} note={note} onToggle={toggle} pending={pendingIds.has(note.id)} selected={selectedIds.has(note.id)} style={{ height: row.size, position: 'absolute', transform: `translateY(${row.start}px)`, width: '100%' }} />; })}</div>
      {isFetching ? <p aria-live="polite">Loading more notes…</p> : null}
    </div> : null}
  </section>;
}
