import { useVirtualizer } from '@tanstack/react-virtual';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { NoteStatus } from '../../domain';
import type { NoteSummary } from '../../backend/contracts';
import type { BulkRequest, NotePage } from '../../backend/contracts';
import { noteApi } from '../../data/api-client';
import { demoReviewers, isDemoReviewer } from '../../auth/demo-reviewers';
import { useRealtimeNotes } from '../../data/use-realtime-notes';
import { parseNotesListUrlState, notesListUrlParams, type NotesListUrlState } from './url-state';
import { useNotesList } from './use-notes-list';
import './notes-list.css';

const allStatuses: readonly NoteStatus[] = ['GENERATING', 'FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'AMENDED', 'LOCKED'];
const columns: ReadonlyArray<{ key: 'patientName' | 'status' | 'updatedAt' | 'createdAt'; label: string }> = [
  { key: 'patientName', label: 'Patient' }, { key: 'status', label: 'Status' }, { key: 'updatedAt', label: 'Updated' }, { key: 'createdAt', label: 'Created' },
];

const statusLabel = (status: NoteStatus): string => status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

function StatusFilter({ selected, onChange }: { selected: readonly NoteStatus[]; onChange: (statuses: readonly NoteStatus[]) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isAllSelected = selected.length === allStatuses.length;
  const update = (statuses: readonly NoteStatus[]): void => onChange(statuses);
  const toggle = (status: NoteStatus): void => {
    const next = selected.includes(status) ? selected.filter((item) => item !== status) : [...selected, status];
    update(next);
  };
  useEffect(() => {
    const close = (event: PointerEvent): void => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <div className="filter-field status-filter" ref={rootRef}><span className="filter-label">Status</span><div className="status-filter-control"><button aria-expanded={open} aria-haspopup="listbox" className="status-trigger" onClick={() => setOpen((current) => !current)} type="button">{isAllSelected ? 'All statuses' : selected.length === 0 ? 'No statuses' : `${selected.length} selected`}<span aria-hidden="true">⌄</span></button>{!isAllSelected ? <div aria-label="Selected statuses" className="status-chips">{selected.map((status) => <span className="status-chip" key={status}>{statusLabel(status)}<button aria-label={`Remove ${statusLabel(status)}`} onClick={() => toggle(status)} type="button">×</button></span>)}<button className="clear-statuses" onClick={() => update(allStatuses)} type="button">Show all</button></div> : null}</div>{open ? <div aria-label="Status options" className="status-menu" role="listbox">{allStatuses.map((status) => <label className="status-option" key={status}><input checked={selected.includes(status)} onChange={() => toggle(status)} type="checkbox" />{statusLabel(status)}</label>)}</div> : null}</div>;
}

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
  const listHeight = Math.min(virtualizer.getTotalSize() + 48, 640);
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
  const normalizedReviewerId = reviewerId.trim();
  const hasReviewerId = isDemoReviewer(normalizedReviewerId);
  const runBulk = (operation: BulkRequest['operation']) => bulkMutation.mutate({ operation, noteIds: [...selectedIds], reviewerId: normalizedReviewerId, actor: { id: 'clinician-1', displayName: 'Demo clinician', roles: ['CLINICIAN'] } });
  const initialLoading = status === 'pending';
  const hasFilters = state.search !== '' || state.statuses !== undefined || state.patient !== undefined || state.reviewerId !== undefined || state.from !== undefined || state.to !== undefined;

  return <section aria-labelledby="notes-title">
    <h1 id="notes-title">Notes</h1>
    <div className="notes-filters" role="search">
      <label className="filter-field"><span className="filter-label">Search</span><input aria-label="Search notes" onChange={(event) => updateUrl({ search: event.target.value })} placeholder="Patient or note content" value={state.search} /></label>
      <StatusFilter onChange={(statuses) => updateUrl({ statuses })} selected={state.statuses ?? allStatuses} />
      <label className="filter-field"><span className="filter-label">Reviewer</span><input aria-label="Reviewer filter" onChange={(event) => updateUrl({ reviewerId: event.target.value })} placeholder="e.g. reviewer-2" value={state.reviewerId ?? ''} /></label>
      <label className="filter-field"><span className="filter-label">Patient</span><input aria-label="Patient filter" onChange={(event) => updateUrl({ patient: event.target.value })} placeholder="Patient name" value={state.patient ?? ''} /></label>
      <label className="filter-field"><span className="filter-label">From</span><input aria-label="From date" max={state.to} onChange={(event) => updateUrl({ from: event.target.value })} type="date" value={state.from ?? ''} /></label>
      <div className="filter-field"><div className="date-label-row"><span className="filter-label">To</span>{state.from !== undefined || state.to !== undefined ? <button className="clear-dates" onClick={() => updateUrl({ from: '', to: '' })} type="button">Clear</button> : null}</div><input aria-label="To date" min={state.from} onChange={(event) => updateUrl({ to: event.target.value })} type="date" value={state.to ?? ''} /></div>
    </div>
    <div className="bulk-toolbar"><p aria-live="polite"><strong>{selectedIds.size}</strong> selected across loaded pages</p><label className="reviewer-assignment"><span>Assign reviewer</span><input aria-describedby={hasReviewerId ? undefined : 'reviewer-required'} aria-invalid={!hasReviewerId} list="available-reviewers" onChange={(event) => setReviewerId(event.target.value)} placeholder="Choose a reviewer" value={reviewerId} /><datalist id="available-reviewers">{demoReviewers.map((reviewer) => <option key={reviewer.id} label={reviewer.displayName} value={reviewer.id} />)}</datalist></label><button disabled={selectedIds.size === 0 || !hasReviewerId || bulkMutation.isPending} onClick={() => runBulk('assign_reviewer')} type="button">Assign reviewer</button><button disabled={selectedIds.size === 0 || bulkMutation.isPending} onClick={() => runBulk('regenerate')} type="button">Request regeneration</button>{!hasReviewerId ? <span className="sr-only" id="reviewer-required">Choose a reviewer from the available reviewer list before assigning selected notes.</span> : null}</div>
    {initialLoading ? <div aria-label="Loading notes" className="notes-skeleton">Loading notes…</div> : null}
    {status === 'error' ? <div role="alert">Could not load notes: {error.message}</div> : null}
    {!initialLoading && status === 'success' && notes.length === 0 ? <div className="notes-empty" role="status"><h2>{hasFilters ? 'No matching notes' : 'No notes yet'}</h2><p>{hasFilters ? 'Try changing or clearing the current search and filters.' : 'Notes will appear here when generation begins.'}</p></div> : null}
    {notes.length > 0 ? <div aria-label="Notes results" className="notes-grid" ref={parentRef} role="grid" style={{ height: `${listHeight}px` }}>
      <div className="notes-header" role="row"><div role="columnheader">Select</div>{columns.map((column) => {
        const isSorted = state.sort === column.key;
        const direction = state.direction === 'asc' ? 'ascending' : 'descending';
        return <button aria-label={`Sort by ${column.label}${isSorted ? `, currently ${direction}` : ''}`} aria-sort={isSorted ? direction : 'none'} className={isSorted ? 'is-sorted' : undefined} key={column.key} onClick={() => updateSort(column.key)} role="columnheader" type="button"><span>{column.label}</span><span aria-hidden="true" className="sort-indicator">{isSorted ? (state.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>;
      })}</div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>{virtualRows.map((row) => { const note = notes[row.index]!; return <NoteRow index={row.index} key={note.id} note={note} onToggle={toggle} pending={pendingIds.has(note.id)} selected={selectedIds.has(note.id)} style={{ height: row.size, position: 'absolute', transform: `translateY(${row.start}px)`, width: '100%' }} />; })}</div>
      {isFetching ? <p aria-live="polite">Loading more notes…</p> : null}
    </div> : null}
  </section>;
}
