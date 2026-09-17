import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { diffWords, isNoteReadOnly, selectActions, type SoapContent, type TransitionAction, type User } from '../../domain';
import { noteApi } from '../../data/api-client';
import { ApiClientError } from '../../data/api-client';
import type { NoteVersion } from '../../domain';
import { dirtySections, type SoapSection, type WorkingDraft } from './draft';
import { beginOptimisticTransition, reconcileTransitionEvents } from './optimistic-transition';
import { SaveCoordinator } from './save-coordinator';
import { resolveVersionConflict, type VersionConflict } from './conflict-resolution';
import { queueVersionSave } from '../../data/offline-queue';
import { queueTransition } from '../../data/offline-queue';
import { useOfflineSync } from '../../data/offline-sync';
import { useRealtimeNotes } from '../../data/use-realtime-notes';
import './note-detail.css';

const sections: ReadonlyArray<{ key: SoapSection; label: string }> = [
  { key: 'subjective', label: 'Subjective' }, { key: 'objective', label: 'Objective' }, { key: 'assessment', label: 'Assessment' }, { key: 'plan', label: 'Plan' },
];
const actionLabels: Readonly<Record<TransitionAction['type'], string>> = {
  'generation.complete': 'Complete generation', 'generation.error': 'Record generation error', regenerate: 'Regenerate', start_review: 'Start review', return: 'Return to queue', approve: 'Approve', reject: 'Reject', resubmit: 'Resubmit', amend: 'Amend', grace_expired: 'Lock after grace period',
};

const mutationId = (): string => globalThis.crypto?.randomUUID?.() ?? `mutation-${Date.now()}`;

export function NoteDetailPage() {
  const { noteId = '' } = useParams(); const queryClient = useQueryClient();
  const { online, refreshQueue, replayConflict } = useOfflineSync();
  const detail = useQuery({ queryKey: ['note', noteId], queryFn: () => noteApi.get(noteId), enabled: noteId !== '' });
  const [draft, setDraft] = useState<WorkingDraft | null>(null); const [rejectReason, setRejectReason] = useState('');
  const [selectedVersions, setSelectedVersions] = useState<readonly string[]>([]);
  const [acknowledged, setAcknowledged] = useState<NoteVersion | null>(null); const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [optimistic, setOptimistic] = useState<ReturnType<typeof beginOptimisticTransition> | null>(null); const [transitionError, setTransitionError] = useState<string | null>(null); const [transitionPending, setTransitionPending] = useState(false);
  const initializedNoteId = useRef<string | null>(null); const draftRef = useRef<WorkingDraft | null>(null); const baseVersionIdRef = useRef(''); const coordinatorRef = useRef<SaveCoordinator<SoapContent, NoteVersion | { queued: true }> | null>(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useRealtimeNotes(noteId === '' ? [] : [noteId], (event) => { if (event.type === 'note.version_added' && draftRef.current !== null && event.version.id !== draftRef.current.baseVersionId) setConflict({ commonAncestor: acknowledged, server: event.version, local: draftRef.current }); });
  useEffect(() => { if (replayConflict !== null && replayConflict.noteId === noteId && draftRef.current !== null) setConflict({ commonAncestor: replayConflict.commonAncestor, server: replayConflict.current, local: draftRef.current }); }, [noteId, replayConflict]);
  useEffect(() => { if (detail.data?.currentVersion !== null && detail.data?.currentVersion !== undefined && initializedNoteId.current !== noteId) { initializedNoteId.current = noteId; const initial = { baseVersionId: detail.data.currentVersion.id, content: { ...detail.data.currentVersion.content } }; baseVersionIdRef.current = initial.baseVersionId; setAcknowledged(detail.data.currentVersion); setDraft(initial); setConflict(null); } }, [detail.data?.currentVersion, noteId]);
  const actor: User | null = useMemo(() => detail.data === undefined ? null : { id: detail.data.assignedReviewerId ?? 'reviewer-1', displayName: 'Demo review user', roles: ['CLINICIAN', 'REVIEWER', 'ADMIN'] }, [detail.data]);
  const displayedNote = optimistic?.optimisticNote ?? detail.data;
  const context = displayedNote === undefined ? null : { note: displayedNote, actor, source: 'USER' as const, now: new Date().toISOString(), mfaReauthenticated: true };
  const actions = context === null ? [] : selectActions(context, { reject: { type: 'reject', reason: rejectReason } });
  const readOnly = context === null || isNoteReadOnly(context);
  const dirtiness = draft === null || acknowledged === null ? null : dirtySections(draft.content, acknowledged.content);
  const refresh = useCallback((): void => { void queryClient.invalidateQueries({ queryKey: ['note', noteId] }); void queryClient.invalidateQueries({ queryKey: ['notes'] }); }, [noteId, queryClient]);
  useEffect(() => {
    if (actor === null) return;
    coordinatorRef.current?.dispose();
    coordinatorRef.current = new SaveCoordinator<SoapContent, NoteVersion | { queued: true }>({ debounceMs: 700, prepare: (content) => ({ baseVersionId: baseVersionIdRef.current, content, clientMutationId: mutationId() }), save: async (request) => { if (!online) { await queueVersionSave(noteId, { ...request, actor }); await refreshQueue(); return { queued: true }; } return noteApi.saveVersion(noteId, { ...request, actor }); }, onSaved: (result) => { if ('queued' in result) { setSaveError(null); return; } baseVersionIdRef.current = result.id; setAcknowledged(result); setSaveError(null); refresh(); }, onFailed: (error) => { if (error instanceof ApiClientError && error.payload.error === 'version_conflict' && draftRef.current !== null) setConflict({ commonAncestor: error.payload.commonAncestor, server: error.payload.current, local: draftRef.current }); setSaveError(error instanceof Error ? error.message : 'Unable to save draft.'); } });
    return () => coordinatorRef.current?.dispose();
  }, [actor, noteId, online, refresh, refreshQueue]);
  useEffect(() => { if (draft !== null && dirtiness !== null && Object.values(dirtiness).some(Boolean) && conflict === null) coordinatorRef.current?.schedule(draft.content); }, [conflict, dirtiness, draft]);
  const executeAction = (type: TransitionAction['type']): void => {
    const action: TransitionAction = type === 'reject' ? { type, reason: rejectReason } : { type };
    if (context === null || transitionPending) return;
    const transaction = beginOptimisticTransition(context, action, `temporary-${mutationId()}`);
    if (transaction === null) return;
    setTransitionError(null); setOptimistic(transaction); setTransitionPending(true);
    if (!online) { void queueTransition(noteId, { action, actor, mfaReauthenticated: true }, transaction.temporaryEvent.id).then(async () => { await refreshQueue(); setTransitionPending(false); }); return; }
    void noteApi.transition(noteId, { action, actor, mfaReauthenticated: true }).then((response) => {
      queryClient.setQueryData(['note', noteId], (previous: typeof detail.data | undefined) => previous === undefined ? previous : { ...previous, ...response.note, events: reconcileTransitionEvents([...previous.events, transaction.temporaryEvent], transaction.temporaryEvent.id, response.event) });
      setOptimistic(null); setTransitionPending(false); refresh();
    }).catch((error: unknown) => { setOptimistic(null); setTransitionPending(false); setTransitionError(error instanceof Error ? error.message : 'Transition failed.'); });
  };
  const compared = selectedVersions.map((id) => detail.data?.versions.find((version) => version.id === id)).filter((version): version is NoteVersion => version !== undefined);

  if (detail.status === 'pending') return <p aria-busy="true">Loading note…</p>;
  if (detail.status === 'error' || detail.data === undefined) return <p role="alert">Could not load this note.</p>;
  return <section aria-labelledby="note-title"><Link to="/notes">← Notes</Link><h1 id="note-title">{detail.data.patientName}</h1><p>{detail.data.status}</p>
    <div className="note-actions" aria-label="Note actions">
      {actions.map((item) => <span key={item.action}><button aria-describedby={item.disabledReason === null ? undefined : `${item.action}-reason`} disabled={!item.enabled || transitionPending} onClick={() => executeAction(item.action)} type="button">{actionLabels[item.action]}</button>{item.disabledReason === null ? null : <span className="sr-only" id={`${item.action}-reason`}>{item.disabledReason}</span>}</span>)}
      <label>Rejection reason <input onChange={(event) => setRejectReason(event.target.value)} value={rejectReason} /></label>
      {transitionError === null ? null : <p role="alert">{transitionError}</p>}
    </div>
    <div className="note-detail-layout"><form aria-label="SOAP editor" className="soap-editor" onSubmit={(event) => { event.preventDefault(); if (draft !== null) coordinatorRef.current?.flush(draft.content); }}>
      <h2>SOAP note</h2>{sections.map(({ key, label }) => <label key={key}>{label}{dirtiness?.[key] ? <span className="dirty-indicator"> Unsaved changes</span> : null}<textarea aria-label={label} disabled={readOnly} onChange={(event) => setDraft((current) => current === null ? current : { ...current, content: { ...current.content, [key]: event.target.value } })} value={draft?.content[key] ?? ''} /></label>)}
      <button disabled={readOnly || draft === null || dirtiness === null || !Object.values(dirtiness).some(Boolean)} type="submit">Save now</button>{saveError === null ? null : <p role="alert">{saveError} <button onClick={() => coordinatorRef.current?.retryFailed()} type="button">Retry</button></p>}
    </form>
    <aside aria-label="Version history" className="history-sidebar"><h2>Version history</h2><ol>{detail.data.versions.map((version) => <li key={version.id}><label><input checked={selectedVersions.includes(version.id)} onChange={() => setSelectedVersions((current) => current.includes(version.id) ? current.filter((id) => id !== version.id) : [...current.slice(-1), version.id])} type="checkbox" />{version.id} · {new Date(version.createdAt).toLocaleString()}</label></li>)}</ol>
      {compared.length === 2 ? <VersionDiff after={compared[0]!} before={compared[1]!} /> : <p>Select two versions to compare.</p>}</aside>
    </div>
    {conflict === null ? null : <ConflictPanel conflict={conflict} onResolve={(content) => { baseVersionIdRef.current = conflict.server.id; setAcknowledged(conflict.server); setDraft({ baseVersionId: conflict.server.id, content }); setConflict(null); }} />}
    <section aria-label="Review timeline"><h2>Review timeline</h2><ol className="timeline">{[...detail.data.events, ...(optimistic === null ? [] : [optimistic.temporaryEvent])].map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time> — {event.action} by {event.actorId}{event.reason === null ? '' : `: ${event.reason}`}</li>)}</ol></section>
  </section>;
}

function ConflictPanel({ conflict, onResolve }: { conflict: VersionConflict; onResolve: (content: SoapContent) => void }) {
  return <section aria-label="Version conflict" className="conflict-panel"><h2>Version conflict</h2><p>Your edits are preserved. Choose a starting resolution, then save a new version based on the server head.</p><div className="conflict-columns"><article><h3>Common ancestor</h3><pre>{JSON.stringify(conflict.commonAncestor?.content ?? null, null, 2)}</pre></article><article><h3>Server head</h3><pre>{JSON.stringify(conflict.server.content, null, 2)}</pre></article><article><h3>Your local edits</h3><pre>{JSON.stringify(conflict.local.content, null, 2)}</pre></article></div><button onClick={() => onResolve(resolveVersionConflict(conflict, 'local').content)} type="button">Accept local</button><button onClick={() => onResolve(resolveVersionConflict(conflict, 'server').content)} type="button">Accept server</button><button onClick={() => onResolve(resolveVersionConflict(conflict, 'manual').content)} type="button">Continue manual merge</button></section>;
}

function VersionDiff({ before, after }: { before: NoteVersion; after: NoteVersion }) {
  return <section aria-label="Word-level version comparison"><h3>Version comparison</h3>{sections.map(({ key, label }) => <article key={key}><h4>{label}</h4><p>{diffWords(before.content[key], after.content[key]).map((token, index) => <span className={`diff-${token.kind}`} key={`${token.value}-${index}`}>{token.value}</span>)}</p></article>)}</section>;
}
